using XSpeedUp.Agent;

internal static class TuningTests
{
    public static void Run(string workspace, Action<bool, string> check, Action<Action, string> reject)
    {
        var journal = new Journal(Path.Combine(workspace, "tuning-journal"));
        var gpu = new FakeClocks(); var time = DateTime.UtcNow;
        string? armed = null;
        var tuner = new AutoTuner(journal, gpu, () => time, id => armed = id);
        var state = tuner.Start("GPU-fixture");
        check(armed == state.Id && gpu.Writes == 0, "Tuning arms independent recovery and saves baseline before clock writes");
        reject(() => tuner.Advance(state.Id), "Untested tuning steps are rejected");
        check(journal.Read(state.Id).Restored && gpu.Core == 0, "A rejected early step leaves baseline restored");
        void Wait(string id, int seconds) { for (int i = 0; i < seconds; i += 5) { time += TimeSpan.FromSeconds(5); tuner.Heartbeat(id); } }
        state = tuner.Start("GPU-fixture");
        gpu.BeforeWrite = () => check(journal.Read(state.Id).Tuning!.ExpectedCore >= gpu.Core, "Clock intent is persisted before a driver write");
        int steps = 0;
        while (state.More) { Wait(state.Id, 45); state = tuner.Advance(state.Id); steps++; }
        gpu.BeforeWrite = null;
        check(steps == 5 && gpu.Core == 45 && gpu.Memory == 100, "Automatic tuning stays within bounded core and memory increments");
        reject(() => tuner.Finish(state.Id, true), "Final profile requires extended validation");
        Wait(state.Id, 120);
        tuner.Finish(state.Id, true);
        var backup = journal.Read(state.Id);
        check(backup.Restored && backup.Tuning!.Completed && backup.Tuning.PassedCore == 45 && gpu.Core == 0 && gpu.Memory == 0, "Completed tuning records tested values and restores baseline");
        state = tuner.Start("GPU-fixture"); Wait(state.Id, 45); state = tuner.Advance(state.Id);
        time += TimeSpan.FromSeconds(16);
        var independent = new AutoTuner(journal, gpu, () => time, _ => {});
        check(independent.WatchdogTick(state.Id) && gpu.Core == 0 && journal.Read(state.Id).Restored, "Independent watchdog recovers an expired renderer lease");
        state = tuner.Start("GPU-fixture"); Wait(state.Id, 45); state = tuner.Advance(state.Id); gpu.Heat = 75;
        reject(() => tuner.Heartbeat(state.Id), "Thermal limit stops a tuning session");
        check(gpu.Core == 0 && journal.Read(state.Id).Restored, "Thermal stop restores original clocks");
        check(tuner.Finish(state.Id, false).Skipped == 0, "Renderer cleanup accepts restoration already completed by thermal recovery");
        reject(() => tuner.Finish(state.Id, true), "A recovered thermal failure cannot be reported as a passed final validation");
        gpu.Heat = 40;
        state = tuner.Start("GPU-fixture"); Wait(state.Id, 45); state = tuner.Advance(state.Id); gpu.Core = 300;
        var conflict = tuner.Finish(state.Id, false);
        check(conflict.Skipped == 1 && gpu.Core == 300, "Recovery preserves an external clock change");
        gpu.Core = 15; tuner.Restore(journal.Read(state.Id));
        state = tuner.Start("GPU-fixture"); Wait(state.Id, 45); gpu.FailAfterWrite = true;
        reject(() => tuner.Advance(state.Id), "A driver failure after changing clocks aborts tuning");
        check(gpu.Core == 0 && journal.Read(state.Id).Restored, "Persisted write intent recovers a partial driver failure");
        state = tuner.Start("GPU-fixture"); Wait(state.Id, 45); state = tuner.Advance(state.Id);
        gpu.Heat = 75;
        reject(() => tuner.Finish(state.Id, true), "Final validation cannot accept an overheated candidate");
        check(gpu.Core == 0 && journal.Read(state.Id).Restored, "Final validation failure immediately restores baseline");
        gpu.Heat = 40;
        var unarmed = new AutoTuner(journal, gpu, () => time, _ => throw new IOException("Fixture watchdog unavailable"));
        int writes = gpu.Writes;
        reject(() => unarmed.Start("GPU-fixture"), "Tuning cannot start without independent recovery readiness");
        check(gpu.Writes == writes && journal.Entries().All(e => e.Restored), "Failed recovery startup has no clock side effects or stale lease");
        gpu.Supported = false;
        reject(() => tuner.Start("GPU-fixture"), "Unsupported driver capabilities never enter tuning");
        gpu.Supported = true; state = tuner.Start("GPU-fixture");
        for (int i = 0; i < 101; i++) journal.Save(new JournalEntry { Kind = "cleanup", CreatedAt = time.AddMinutes(1) });
        check(Json.Serialize(journal.List()).Contains(state.Id), "Pending clock recovery remains visible beyond the recent-history limit");
        tuner.Finish(state.Id, false);
    }
    private sealed class FakeClocks : IGpuClocks
    {
        public int Core, Memory, Writes, Heat = 40;
        public bool Supported = true;
        public bool FailAfterWrite;
        public Action? BeforeWrite;
        public GpuCapability[] Discover() => [new("GPU-fixture", "Fixture GPU", Heat, new(Core, -500, 500), new(Memory, -500, 500), Supported, "")];
        public int Temperature(string id) => Heat;
        public ClockRange Read(string id, int domain) => new(domain == 0 ? Core : Memory, -500, 500);
        public void Write(string id, int domain, int offset) {
            BeforeWrite?.Invoke(); Writes++; if (domain == 0) Core = offset; else Memory = offset;
            if (FailAfterWrite) { FailAfterWrite = false; throw new IOException("Fixture readback failure after write"); }
        }
    }
}
