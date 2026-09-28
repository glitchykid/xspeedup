using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace XSpeedUp.Agent;

public interface IGameEnvironment
{
    bool IsAdmin { get; }
    int? ReadMode();
    bool ExchangeMode(int? expected, int? replacement);
    uint ServiceState(string id);
    void SetRunning(string id, bool running);
    ProcessItem[] Processes();
    ActionResult Close(GameProcess process);
}

public sealed class WindowsGameEnvironment : IGameEnvironment
{
    private readonly WindowsRegistryStore registry = new();
    public bool IsAdmin => Services.IsAdmin;
    public int? ReadMode() => registry.ReadGameMode();
    public bool ExchangeMode(int? expected, int? replacement) => registry.ExchangeGameMode(expected, replacement);
    public ProcessItem[] Processes() => SystemInspection.Processes();
    public ActionResult Close(GameProcess process) => SystemInspection.Close(process.Id, process.StartTime);
    private static T WithService<T>(string id, uint access, Func<IntPtr, T> action)
    {
        if (!GameMode.ServiceIds.Contains(id)) throw new ArgumentException("Service is outside the gaming catalog.");
        var manager = Native.OpenSCManager(null, null, 1);
        if (manager == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        IntPtr service = IntPtr.Zero;
        try
        {
            service = Native.OpenService(manager, id, access);
            if (service == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            return action(service);
        }
        finally { if (service != IntPtr.Zero) Native.CloseServiceHandle(service); Native.CloseServiceHandle(manager); }
    }
    private static uint State(IntPtr service)
    {
        if (!Native.QueryServiceStatus(service, out var state)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return state.State;
    }
    public uint ServiceState(string id) => WithService(id, 4, State);
    public void SetRunning(string id, bool running) => WithService(id, 4u | (running ? 0x10u : 0x20u), service =>
    {
        uint target = running ? 4u : 1u;
        var state = State(service);
        if (state == target) return true;
        if (state != (running ? 1u : 4u)) throw new IOException("Service is transitioning; retry later.");
        // SCM rejects stopping a service with running dependants; never stop those dependants.
        bool sent = running ? Native.StartService(service, 0, IntPtr.Zero) : Native.ControlService(service, 1, out _);
        if (!sent) throw new Win32Exception(Marshal.GetLastWin32Error());
        var timer = Stopwatch.StartNew();
        while (timer.Elapsed < TimeSpan.FromSeconds(12))
        {
            if (State(service) == target) return true;
            Thread.Sleep(150);
        }
        throw new IOException("Service transition timed out; recovery is retained in history.");
    });
}

public sealed class GameMode(Journal journal, IGameEnvironment? environment = null)
{
    public static readonly string[] ServiceIds = ["DiagTrack", "MapsBroker", "Fax"];
    private readonly IGameEnvironment system = environment ?? new WindowsGameEnvironment();
    private JournalEntry? Active() => journal.Entries().Where(e => e.Kind == "gaming" && !e.Restored && e.Game is not null)
        .OrderByDescending(e => e.CreatedAt).FirstOrDefault();
    public GameStatus Status()
    {
        int? mode = null; bool available = true;
        try { mode = system.ReadMode(); } catch (Exception ex) when (Expected(ex)) { available = false; }
        var services = ServiceIds.Select(id =>
        {
            uint state = 0;
            try { state = system.ServiceState(id); } catch (Exception ex) when (Expected(ex)) { }
            return new GameService(id, state, system.IsAdmin && state == 4);
        }).ToArray();
        return new(Active()?.Id, mode, available, services);
    }
    private static bool Expected(Exception ex) => ex is IOException or Win32Exception or UnauthorizedAccessException or InvalidOperationException;
    public ActionResult Start(string[] ids, GameProcess[] processes)
    {
        if (Active() is not null) throw new InvalidOperationException("Игровой режим уже активен. Сначала восстановите предыдущую сессию.");
        if (ids.Any(id => !ServiceIds.Contains(id)) || ids.Length > ServiceIds.Length || processes.Length > 10000 ||
            processes.Any(p => p.Id <= 0 || string.IsNullOrWhiteSpace(p.StartTime)) || processes.Select(p => p.Id).Distinct().Count() != processes.Length)
            throw new ArgumentException("Некорректный игровой профиль.");
        if (ids.Length > 0 && !system.IsAdmin) throw new UnauthorizedAccessException("Для остановки служб нужны права администратора.");
        var available = system.Processes();
        if (processes.Any(p => !available.Any(a => a.Id == p.Id && a.StartTime == p.StartTime)))
            throw new InvalidOperationException("Список приложений изменился. Обновите его.");
        var original = system.ReadMode();
        var entry = new JournalEntry { Kind = "gaming", Summary = "Подготовка игрового режима.", Game = new() { OriginalMode = original, RestoreMode = original != 1 } };
        journal.Save(entry);
        int changed = 0, skipped = 0;
        try
        {
            if (original != 1)
            {
                if (!system.ExchangeMode(original, 1)) throw new IOException("Windows Game Mode changed during activation; retry after recovery.");
                changed++;
            }
        }
        catch (Exception ex) when (Expected(ex))
        { entry.Details.Add(ex.Message); journal.Save(entry); throw; }
        foreach (var id in ids.Distinct())
        {
            try
            {
                if (system.ServiceState(id) != 4) { skipped++; continue; }
                entry.Game.StoppedServices.Add(id); journal.Save(entry);
                system.SetRunning(id, false); changed++;
            }
            catch (Exception ex) when (Expected(ex)) { skipped++; entry.Details.Add($"{id}: {ex.Message}"); }
        }
        foreach (var process in processes)
        {
            try
            {
                var result = system.Close(process);
                changed += result.Changed; skipped += result.Changed == 0 ? 1 : 0;
                entry.Details.Add($"PID {process.Id}: {result.Message}");
            }
            catch (Exception ex) when (Expected(ex) || ex is ArgumentException) { skipped++; entry.Details.Add($"PID {process.Id}: {ex.Message}"); }
        }
        entry.Summary = $"Игровой режим: применено действий — {changed}, пропущено — {skipped}.";
        entry.Details.Add("Закрытие приложений — обычный запрос с возможностью сохранения документов. Приложения не перезапускаются автоматически. Прирост FPS не гарантируется.");
        journal.Save(entry);
        return new(entry.Summary, changed, skipped, Details: entry.Details);
    }
    public ActionResult Stop() => Active() is { } entry ? Restore(entry) : throw new InvalidOperationException("Активного игрового режима нет.");
    public ActionResult Restore(JournalEntry entry)
    {
        var backup = entry.Game ?? throw new ArgumentException("Нет игрового профиля.");
        if (entry.Kind != "gaming" || backup.OriginalMode is not (null or 0 or 1) || backup.StoppedServices.Any(id => !ServiceIds.Contains(id)))
            throw new ArgumentException("Некорректная игровая копия.");
        int changed = 0, skipped = 0;
        var details = new List<string>();
        if (backup.RestoreMode)
        {
            try
            {
                var current = system.ReadMode();
                if (current == backup.OriginalMode) backup.RestoreMode = false;
                else if (current == 1 && system.ExchangeMode(1, backup.OriginalMode)) { backup.RestoreMode = false; changed++; }
                else skipped++;
            }
            catch (Exception ex) when (Expected(ex)) { skipped++; details.Add(ex.Message); }
            journal.Save(entry);
        }
        foreach (var id in backup.StoppedServices.ToArray())
        {
            try
            {
                var state = system.ServiceState(id);
                if (state == 1) { system.SetRunning(id, true); changed++; }
                else if (state != 4) { skipped++; continue; }
                backup.StoppedServices.Remove(id); journal.Save(entry);
            }
            catch (Exception ex) when (Expected(ex)) { skipped++; details.Add($"{id}: {ex.Message}"); }
        }
        entry.Restored = !backup.RestoreMode && backup.StoppedServices.Count == 0;
        entry.Details.AddRange(details); journal.Save(entry);
        return new("Восстановление игрового профиля завершено. Невосстановленные действия можно повторить из истории.", changed, skipped, Details: details);
    }
}
