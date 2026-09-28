using System.Diagnostics;
using System.Security.Principal;

namespace XSpeedUp.Agent;

// A bounded experimental scan, not a promise of universal or long-term stability.
public sealed class AutoTuner(Journal journal, IGpuClocks? adapter = null, Func<DateTime>? clock = null, Action<string>? arm = null)
{
    private readonly IGpuClocks gpu = adapter ?? new NvidiaClocks();
    private readonly Func<DateTime> now = clock ?? (() => DateTime.UtcNow);
    private static string MutexName => @"Local\XSpeedUp-Tuning-" + WindowsIdentity.GetCurrent().User?.Value;
    private T Locked<T>(Func<T> action)
    {
        using var mutex = new Mutex(false, MutexName);
        bool acquired = false;
        try
        {
            try { acquired = mutex.WaitOne(TimeSpan.FromSeconds(8)); } catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) throw new IOException("Clock recovery is busy.");
            return action();
        }
        finally { if (acquired) mutex.ReleaseMutex(); }
    }
    public object Status() => new {
        Devices = gpu.Discover(),
        Pending = journal.Entries().Where(e => e.Tuning is not null && !e.Restored).Select(e => e.Id).ToArray(),
        Cpu = ReadCpu(),
        CpuTuning = false, MemoryTuning = false,
        Reason = "CPU multipliers, system RAM timings and other vendors require a supported manufacturer adapter. This version only probes NVIDIA NVML GPU clock offsets."
    };
    private static string ReadCpu()
    {
        using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"HARDWARE\DESCRIPTION\System\CentralProcessor\0");
        return key?.GetValue("ProcessorNameString") as string ?? "CPU";
    }
    private JournalEntry Read(string id)
    {
        var entry = journal.Read(id);
        if (entry.Kind != "tuning" || entry.Tuning is null || entry.Restored) throw new InvalidOperationException("No active tuning session.");
        return entry;
    }
    private List<(int Core, int? Memory)> Plan(TuningBackup b)
    {
        var core = gpu.Read(b.Device, 0);
        var result = new List<(int, int?)>();
        foreach (int increment in new[] { 15, 30, 45 })
            if ((long)b.OriginalCore + increment <= core.Maximum) result.Add((b.OriginalCore + increment, b.OriginalMemory));
        if (b.OriginalMemory is int originalMemory && result.Count > 0)
        {
            var memory = gpu.Read(b.Device, 2);
            int topCore = result[^1].Item1;
            foreach (int increment in new[] { 50, 100 })
                if ((long)originalMemory + increment <= memory.Maximum) result.Add((topCore, originalMemory + increment));
        }
        return result;
    }
    private TuningState State(JournalEntry entry)
    {
        var b = entry.Tuning!;
        return new(entry.Id, b.Stage, b.ExpectedCore, b.ExpectedMemory, gpu.Temperature(b.Device), b.Stage < Plan(b).Count);
    }
    public TuningState Start(string device) => Locked(() =>
    {
        if (journal.Entries().Any(e => e.Tuning is not null && !e.Restored)) throw new InvalidOperationException("Restore the previous tuning session first.");
        var devices = gpu.Discover().Where(d => d.Id.Length > 0).ToArray();
        var selected = devices.SingleOrDefault(d => d.Id == device && d.CanTune);
        if (devices.Length != 1 || selected?.Core is null) throw new InvalidOperationException("Automatic tuning requires one supported GPU with writable clock offsets.");
        if (gpu.Temperature(device) >= 65) throw new IOException("Cool the GPU below 65 °C before starting.");
        var b = new TuningBackup { Device = device, OriginalCore = selected.Core.Current, OriginalMemory = selected.Memory?.Current,
            ExpectedCore = selected.Core.Current, ExpectedMemory = selected.Memory?.Current, PreviousCore = selected.Core.Current,
            PreviousMemory = selected.Memory?.Current, PassedCore = selected.Core.Current, PassedMemory = selected.Memory?.Current,
            Heartbeat = now(), StageStarted = now() };
        var entry = new JournalEntry { Kind = "tuning", Summary = "Automatic GPU tuning: baseline saved.", Tuning = b };
        journal.Save(entry);
        try { (arm ?? ArmWatchdog)(entry.Id); }
        catch { entry.Restored = true; journal.Save(entry); throw; }
        return State(entry);
    });
    private void Healthy(JournalEntry entry)
    {
        var b = entry.Tuning!;
        if (now() - b.Heartbeat > TimeSpan.FromSeconds(15) || now() - entry.CreatedAt > TimeSpan.FromMinutes(20) || gpu.Temperature(b.Device) >= 75)
            throw new IOException("Tuning stopped: temperature, heartbeat or session time limit.");
        if (gpu.Read(b.Device, 0).Current != b.ExpectedCore || b.ExpectedMemory is int memory && gpu.Read(b.Device, 2).Current != memory)
            throw new IOException("Clock settings were changed by another application.");
    }
    public TuningState Heartbeat(string id) => Locked(() =>
    {
        var entry = Read(id);
        try { Healthy(entry); } catch { RestoreCore(entry); throw; }
        entry.Tuning!.Heartbeat = now(); journal.Save(entry); return State(entry);
    });
    public TuningState Advance(string id) => Locked(() =>
    {
        var entry = Read(id); var b = entry.Tuning!;
        try
        {
            Healthy(entry);
            if (now() - b.StageStarted < TimeSpan.FromSeconds(45)) throw new InvalidOperationException("Each baseline/candidate must be tested for at least 45 seconds.");
            var plan = Plan(b);
            if (b.Stage >= plan.Count) throw new InvalidOperationException("No more bounded clock candidates.");
            b.PassedCore = b.ExpectedCore; b.PassedMemory = b.ExpectedMemory;
            b.PreviousCore = b.ExpectedCore; b.PreviousMemory = b.ExpectedMemory;
            var next = plan[b.Stage]; b.ExpectedCore = next.Core; b.ExpectedMemory = next.Memory;
            journal.Save(entry); // Also records a write that fails part way through.
            if (next.Core != b.PreviousCore) gpu.Write(b.Device, 0, next.Core);
            if (next.Memory is int memory && memory != b.PreviousMemory) gpu.Write(b.Device, 2, memory);
            b.Stage++; b.StageStarted = now(); b.Heartbeat = now(); journal.Save(entry);
            return State(entry);
        }
        catch { RestoreCore(entry); throw; }
    });
    public ActionResult Finish(string id, bool completed) => Locked(() =>
    {
        var entry = journal.Read(id);
        if (entry.Kind != "tuning" || entry.Tuning is null) throw new InvalidOperationException("No tuning session.");
        if (entry.Restored)
        {
            if (completed && !entry.Tuning.Completed) throw new IOException("Tuning ended before final validation completed.");
            return new ActionResult("Original clock offsets were already restored.", 0);
        }
        var b = entry.Tuning;
        if (completed)
        {
            try { Healthy(entry); } catch { RestoreCore(entry); throw; }
            if (b.Stage == 0 || now() - b.StageStarted < TimeSpan.FromSeconds(120)) throw new InvalidOperationException("Final validation needs at least 120 seconds.");
            b.PassedCore = b.ExpectedCore; b.PassedMemory = b.ExpectedMemory; b.Completed = true;
            journal.Save(entry);
        }
        return RestoreCore(entry);
    });
    public ActionResult Restore(JournalEntry entry) => Locked(() => RestoreCore(journal.Read(entry.Id)));
    private ActionResult RestoreCore(JournalEntry entry)
    {
        var b = entry.Tuning ?? throw new ArgumentException("Missing clock backup.");
        if (entry.Kind != "tuning" || b.Device.Length > 96 || !b.Device.StartsWith("GPU-", StringComparison.Ordinal) ||
            Math.Abs((long)b.ExpectedCore - b.OriginalCore) > 45 || Math.Abs((long)b.PreviousCore - b.OriginalCore) > 45 ||
            b.OriginalMemory.HasValue != b.ExpectedMemory.HasValue || b.OriginalMemory.HasValue != b.PreviousMemory.HasValue ||
            Math.Abs((long)(b.ExpectedMemory ?? 0) - (b.OriginalMemory ?? 0)) > 100 || Math.Abs((long)(b.PreviousMemory ?? 0) - (b.OriginalMemory ?? 0)) > 100)
            throw new ArgumentException("Invalid clock backup.");
        int changed = 0, skipped = 0; var details = new List<string>();
        void RestoreDomain(int domain, int original, int expected, int previous)
        {
            try
            {
                var current = gpu.Read(b.Device, domain).Current;
                if (current == original) return;
                if (current != expected && current != previous) { skipped++; details.Add("External clock change preserved."); return; }
                gpu.Write(b.Device, domain, original); changed++;
            }
            catch (Exception ex) when (NvidiaClocks.Unavailable(ex) || ex is ArgumentException) { skipped++; details.Add(ex.Message); }
        }
        RestoreDomain(0, b.OriginalCore, b.ExpectedCore, b.PreviousCore);
        if (b.OriginalMemory is int memory) RestoreDomain(2, memory, b.ExpectedMemory!.Value, b.PreviousMemory!.Value);
        entry.Restored = skipped == 0;
        entry.Summary = $"GPU tuning {(b.Completed ? "completed" : "stopped")}. Tested offsets: core {b.PassedCore} MHz; memory {b.PassedMemory} MHz. Baseline restoration: {entry.Restored}.";
        entry.Details.AddRange(details); journal.Save(entry);
        return new(entry.Summary, changed, skipped, Details: details);
    }
    private static void ArmWatchdog(string id)
    {
        using var ready = new EventWaitHandle(false, EventResetMode.ManualReset, @"Local\XSpeedUp-TuneReady-" + id);
        var start = new ProcessStartInfo(Environment.ProcessPath ?? throw new IOException("Agent path unavailable.")) { UseShellExecute = false, CreateNoWindow = true };
        start.ArgumentList.Add("--tuning-watchdog"); start.ArgumentList.Add(id);
        using var process = Process.Start(start) ?? throw new IOException("Could not start clock recovery watchdog.");
        if (!ready.WaitOne(TimeSpan.FromSeconds(5))) throw new IOException("Clock recovery watchdog did not initialize.");
    }
    public static void Watchdog(string id)
    {
        if (!Guid.TryParseExact(id, "N", out _)) return;
        var journal = Journal.Create(); var tuner = new AutoTuner(journal);
        try
        {
            _ = tuner.Read(id);
            using var ready = EventWaitHandle.OpenExisting(@"Local\XSpeedUp-TuneReady-" + id); ready.Set();
            while (true)
            {
                Thread.Sleep(2000);
                bool done = tuner.WatchdogTick(id);
                if (done) return;
            }
        }
        catch { /* Persistent recovery record remains available in History. */ }
    }
    public bool WatchdogTick(string id) => Locked(() => {
        var entry = journal.Read(id);
        if (entry.Restored) return true;
        try { Healthy(entry); return false; }
        catch { RestoreCore(entry); return true; }
    });
}
