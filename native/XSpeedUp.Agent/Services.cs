using Microsoft.Win32;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;

namespace XSpeedUp.Agent;

public interface IServiceSettings
{
    bool IsAdministrator { get; }
    uint ReadStartMode(string name);
    void WriteStartMode(string name, uint mode);
}

public sealed class Services(Journal journal, IServiceSettings? serviceSettings = null)
{
    private readonly IServiceSettings settings = serviceSettings ?? new WindowsServiceSettings();
    public static readonly ServiceDefinition[] Catalog = [
        new("DiagTrack", "Диагностика и телеметрия", "Connected User Experiences and Telemetry", "Перестанут отправляться данные диагностики через эту службу. Некоторые диагностические функции могут быть недоступны.", ["privacy"]),
        new("dmwappushservice", "Маршрутизация WAP Push", "Device Management WAP Push", "Может нарушить управление рабочим устройством через MDM. Не отключайте на корпоративном ПК.", ["privacy"]),
        new("MapsBroker", "Офлайн-карты", "Downloaded Maps Manager", "Загруженные карты не будут обновляться и могут стать недоступны приложениям.", ["minimal"]),
        new("Fax", "Факс", "Fax Service", "Отправка и получение факсов будут недоступны.", ["minimal"]),
        new("XblGameSave", "Облачные сохранения Xbox", "Xbox Live Game Save", "Синхронизация игровых сохранений Xbox будет недоступна. Не отключайте, если используете Xbox.", ["no-xbox"]),
        new("XboxNetApiSvc", "Сеть Xbox Live", "Xbox Live Networking Service", "Может перестать работать сетевая игра и подключение к Xbox Live.", ["no-xbox"])
    ];
    public static bool IsAdmin
    {
        get
        {
            using var identity = WindowsIdentity.GetCurrent();
            return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
        }
    }
    public ServiceItem[] List() => Catalog.Select(def =>
    {
        var mode = settings.ReadStartMode(def.Id);
        string status = "Недоступна";
        var manager = Native.OpenSCManager(null, null, 1);
        if (manager != IntPtr.Zero)
        {
            var handle = Native.OpenService(manager, def.Id, 4);
            try
            {
                if (handle != IntPtr.Zero && Native.QueryServiceStatus(handle, out var state))
                    status = state.State switch { 4 => "Работает", 1 => "Остановлена", _ => "Переходное состояние" };
            }
            finally { if (handle != IntPtr.Zero) Native.CloseServiceHandle(handle); Native.CloseServiceHandle(manager); }
        }
        return new ServiceItem(def.Id, def.Name, def.Description, def.Impact, def.Profiles, mode != uint.MaxValue, status, mode, settings.IsAdministrator && mode is 2 or 3);
    }).ToArray();

    private sealed class WindowsServiceSettings : IServiceSettings
    {
        public bool IsAdministrator => IsAdmin;
        public uint ReadStartMode(string name)
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\" + name);
            return key?.GetValue("Start") is int value ? (uint)value : uint.MaxValue;
        }
        public void WriteStartMode(string name, uint mode)
        {
            if (!Catalog.Any(s => s.Id == name) || mode is < 2 or > 4) throw new ArgumentException("Служба не входит в разрешённый список.");
            var manager = Native.OpenSCManager(null, null, 1);
            if (manager == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            var handle = Native.OpenService(manager, name, 2);
            try
            {
                if (handle == IntPtr.Zero || !Native.ChangeServiceConfig(handle, uint.MaxValue, mode, uint.MaxValue, null, null, IntPtr.Zero, null, null, null, null))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
            }
            finally { if (handle != IntPtr.Zero) Native.CloseServiceHandle(handle); Native.CloseServiceHandle(manager); }
        }
    }

    public ActionResult Disable(string[] ids)
    {
        if (ids.Length == 0 || ids.Any(id => !Catalog.Any(s => s.Id == id))) throw new ArgumentException("Некорректный список служб.");
        if (!settings.IsAdministrator) throw new UnauthorizedAccessException("Для изменения служб запустите приложение от имени администратора.");
        var entry = new JournalEntry { Kind = "services", Summary = "Создана копия исходных режимов запуска служб." };
        int changed = 0, skipped = 0;
        foreach (var id in ids.Distinct())
        {
            var original = settings.ReadStartMode(id);
            if (original is not (2 or 3)) { skipped++; continue; }
            entry.Backups.Add(new() { Name = id, StartMode = original });
            journal.Save(entry);
            try { settings.WriteStartMode(id, 4); changed++; }
            catch (Win32Exception ex) { skipped++; entry.Details.Add($"{id}: {ex.Message}"); }
        }
        entry.Summary = $"Отключён запуск служб: {changed}; пропущено: {skipped}. Изменения вступят в силу после перезагрузки.";
        journal.Save(entry);
        return new(entry.Summary, changed, skipped, Details: entry.Details);
    }

    public ActionResult Restore(JournalEntry entry)
    {
        if (!settings.IsAdministrator) throw new UnauthorizedAccessException("Для восстановления служб нужны права администратора.");
        int changed = 0, skipped = 0;
        foreach (var backup in entry.Backups.Where(b => !b.Restored))
        {
            if (!Catalog.Any(s => s.Id == backup.Name) || backup.StartMode is not (2 or 3)) throw new IOException("Некорректная резервная копия службы.");
            var current = settings.ReadStartMode(backup.Name);
            if (current == backup.StartMode) backup.Restored = true;
            else if (current != 4) { skipped++; continue; }
            else
            {
                try { settings.WriteStartMode(backup.Name, backup.StartMode); backup.Restored = true; changed++; }
                catch (Win32Exception) { skipped++; }
            }
            journal.Save(entry);
        }
        entry.Restored = entry.Backups.All(b => b.Restored);
        journal.Save(entry);
        return new($"Восстановлено служб: {changed}; пропущено: {skipped}. Перезагрузите Windows для применения.", changed, skipped);
    }
}
