using System.ComponentModel;
using System.Diagnostics;

namespace XSpeedUp.Agent;

public sealed class RegistryMaintenance(Journal journal, IRegistryStore? registryStore = null,
    Func<string, bool>? definitelyMissing = null)
{
    public const string VersionRoot = @"Software\Microsoft\Windows\CurrentVersion";
    public const string Uninstall = VersionRoot + @"\Uninstall";
    public const string AppPaths = VersionRoot + @"\App Paths";
    private readonly IRegistryStore store = registryStore ?? new WindowsRegistryStore();
    private readonly Func<string, bool> missing = definitelyMissing ?? MissingLocalPath;
    private readonly Dictionary<string, RegistryBackup> candidates = [];
    private RegistryScan? latest;
    private DateTime scannedAt;
    private static readonly HashSet<string> ProtectedVendors = new(StringComparer.OrdinalIgnoreCase)
    { "Microsoft", "Classes", "Policies", "Clients", "RegisteredApplications", "Wow6432Node", "Windows", "AppDataLow" };
    public static bool Allowed(RegistryBackup backup)
    {
        var a = backup.Address;
        if (a.Hive is not ("HKCU" or "HKLM") || a.View is not (32 or 64) || a.Path.Length > 1024
            || a.Path.Contains('/') || a.Path.Contains('\0')) return false;
        var parts = a.Path.Split('\\');
        if (parts.Any(p => string.IsNullOrWhiteSpace(p) || p is "." or "..")) return false;
        if (backup.ValueName is not null)
            return (a.Path.Equals(RegistryCleaner.RunKey, StringComparison.OrdinalIgnoreCase)
                || a.Path.Equals(VersionRoot + @"\RunOnce", StringComparison.OrdinalIgnoreCase))
                && backup.Snapshot.Children.Length == 0 && backup.Snapshot.Values.Length == 1
                && backup.Snapshot.Values[0].Name == backup.ValueName && backup.Snapshot.Values[0].Kind is 1 or 2;
        if (backup.Snapshot.Children.Length != 0) return false;
        if (new[] { Uninstall, AppPaths }.Any(root => a.Path.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase)
            && !a.Path[(root.Length + 1)..].Contains('\\'))) return true;
        return a.Hive == "HKCU" && parts.Length is >= 2 and <= 4 && parts[0].Equals("Software", StringComparison.OrdinalIgnoreCase)
            && !ProtectedVendors.Contains(parts[1]) && backup.Snapshot.Empty;
    }
    public static bool MissingLocalPath(string path)
    {
        try
        {
            if (!Path.IsPathFullyQualified(path) || path.StartsWith(@"\\") || path.Contains('%')) return false;
            var drive = new DriveInfo(Path.GetPathRoot(path)!);
            if (!drive.IsReady || drive.DriveType != DriveType.Fixed) return false;
            // An inaccessible or redirected ancestor does not prove an installation is gone.
            for (string? current = path; current is not null; current = Path.GetDirectoryName(current))
            {
                try { if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) return false; }
                catch (FileNotFoundException) { }
                catch (DirectoryNotFoundException) { }
            }
            try { _ = File.GetAttributes(path); return false; }
            catch (FileNotFoundException) { return true; }
            catch (DirectoryNotFoundException) { return true; }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException) { return false; }
    }
    private static string? AbsolutePath(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var path = Environment.ExpandEnvironmentVariables(value.Trim().Trim('"'));
        try
        {
            if (!Path.IsPathFullyQualified(path) || path.StartsWith(@"\\") || path.Contains('%') || path.Contains('"')
                || Path.TrimEndingDirectorySeparator(path) == Path.TrimEndingDirectorySeparator(Path.GetPathRoot(path)!)) return null;
            return Path.GetFullPath(path);
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException) { return null; }
    }
    public string? Reason(RegistryBackup backup)
    {
        if (!Allowed(backup)) return null;
        var snapshot = backup.Snapshot;
        if (backup.ValueName is not null)
        {
            var text = snapshot.Values.Single().Data;
            if (string.IsNullOrWhiteSpace(text)) return "Пустая команда автозапуска.";
            var exe = RegistryCleaner.ExecutablePath(text);
            return exe is not null && missing(exe) ? "Файл команды автозапуска отсутствует." : null;
        }
        if (snapshot.Empty) return "Пустой раздел приложения: нет значений и подразделов.";
        if (backup.Address.Path.StartsWith(AppPaths + "\\", StringComparison.OrdinalIgnoreCase))
        {
            var path = AbsolutePath(snapshot.Text(""));
            return path is not null && path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && missing(path)
                ? "App Paths: исполняемый файл приложения отсутствует." : null;
        }
        if (!backup.Address.Path.StartsWith(Uninstall + "\\", StringComparison.OrdinalIgnoreCase)) return null;
        if (Guid.TryParse(backup.Address.Path.Split('\\')[^1], out _) || snapshot.Has("WindowsInstaller")
            || snapshot.Has("SystemComponent") || snapshot.Has("ParentKeyName") || snapshot.Has("ReleaseType")) return null;
        var location = AbsolutePath(snapshot.Text("InstallLocation"));
        var uninstaller = RegistryCleaner.ExecutablePath(snapshot.Text("UninstallString") ?? "");
        if (string.IsNullOrWhiteSpace(snapshot.Text("DisplayName")) || location is null || uninstaller is null
            || !missing(location) || !missing(uninstaller)) return null;
        // Every additional executable reference must also be unambiguous and missing.
        foreach (var name in new[] { "QuietUninstallString", "ModifyPath" })
            if (snapshot.Has(name))
            {
                var other = RegistryCleaner.ExecutablePath(snapshot.Text(name) ?? "");
                if (other is null || !missing(other)) return null;
            }
        if (snapshot.Has("DisplayIcon"))
        {
            var icon = snapshot.Text("DisplayIcon") ?? "";
            int comma = icon.LastIndexOf(',');
            if (comma >= 0 && int.TryParse(icon[(comma + 1)..], out _)) icon = icon[..comma];
            var iconPath = AbsolutePath(icon);
            if (iconPath is null || !missing(iconPath)) return null;
        }
        return "Остаток удалённого приложения: отсутствуют папка установки, деинсталлятор и указанные файлы.";
    }
    public RegistryScan Scan()
    {
        candidates.Clear();
        var entries = new List<RegistryEntry>();
        var warnings = new List<string>();
        var timer = Stopwatch.StartNew();
        int visited = 0;
        bool limited = false;
        RegistrySnapshot? Read(RegistryAddress address)
        {
            if (++visited > 20000 || timer.Elapsed > TimeSpan.FromSeconds(20)) { limited = true; return null; }
            try { return store.Read(address); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or Win32Exception or InvalidCastException)
            { if (warnings.Count < 12) warnings.Add($"Пропущено {address.Hive}\\{address.Path}: {ex.Message}"); return null; }
        }
        void Add(RegistryBackup backup, string name, string value)
        {
            if (entries.Count >= 2000) { limited = true; return; }
            var reason = Reason(backup);
            if (reason is null) return;
            var id = Guid.NewGuid().ToString("N"); candidates[id] = backup;
            entries.Add(new(id, name, $"{backup.Address.Hive}\\{backup.Address.Path} ({backup.Address.View}-bit)", value, reason,
                backup.Address.Hive != "HKLM" || Services.IsAdmin));
        }
        foreach (var (hive, view) in new[] { ("HKCU", 64), ("HKLM", 64), ("HKLM", 32) })
        {
            foreach (var root in new[] { RegistryCleaner.RunKey, VersionRoot + @"\RunOnce" })
            {
                var address = new RegistryAddress(hive, view, root);
                var snapshot = Read(address);
                if (snapshot is null) continue;
                foreach (var value in snapshot.Values.Where(v => v.Kind is 1 or 2))
                    Add(new() { Address = address, ValueName = value.Name, Snapshot = new([value], []) }, value.Name, value.Data);
            }
            foreach (var root in new[] { Uninstall, AppPaths })
            {
                var parent = new RegistryAddress(hive, view, root);
                var snapshot = Read(parent);
                if (snapshot is null) continue;
                foreach (var name in snapshot.Children)
                {
                    if (limited) break;
                    var address = parent with { Path = root + "\\" + name };
                    var child = Read(address);
                    if (child is not null) Add(new() { Address = address, Snapshot = child }, child.Text("DisplayName") ?? name,
                        child.Text("InstallLocation") ?? child.Text("") ?? "Пустой раздел");
                }
            }
        }
        var software = Read(new("HKCU", 64, "Software"));
        if (software is not null)
            foreach (var vendor in software.Children.Where(v => !ProtectedVendors.Contains(v)))
            {
                if (limited) break;
                var queue = new Queue<RegistryAddress>(); queue.Enqueue(new("HKCU", 64, "Software\\" + vendor));
                while (queue.TryDequeue(out var address) && !limited)
                {
                    var child = Read(address);
                    if (child is null) continue;
                    if (child.Empty) Add(new() { Address = address, Snapshot = child }, address.Path.Split('\\')[^1], "Пустой раздел");
                    if (address.Path.Split('\\').Length < 4)
                        foreach (var name in child.Children) queue.Enqueue(address with { Path = address.Path + "\\" + name });
                }
            }
        scannedAt = DateTime.UtcNow;
        latest = new(Guid.NewGuid().ToString("N"), entries, limited, warnings);
        return latest;
    }
    public ActionResult ApplyAll(string scanId) => Apply(scanId, latest?.Entries.Where(e => e.CanChange).Select(e => e.Id).ToArray() ?? []);
    public ActionResult Apply(string scanId, string[] ids)
    {
        if (latest is null || latest.Id != scanId || DateTime.UtcNow - scannedAt > TimeSpan.FromMinutes(15))
            throw new InvalidOperationException("Анализ реестра устарел. Выполните его заново.");
        if (ids.Length == 0 || ids.Any(id => !candidates.ContainsKey(id))) throw new ArgumentException("Некорректный выбор записей.");
        var entry = new JournalEntry { Kind = "registry-v2", Summary = "Резервная копия записей реестра перед очисткой." };
        int changed = 0, skipped = 0;
        foreach (var id in ids.Distinct())
        {
            var backup = candidates[id];
            try
            {
                if (Reason(backup) is null) { skipped++; continue; }
                entry.RegistryBackups.Add(backup);
                journal.Save(entry);
                if (store.DeleteIfUnchanged(backup)) changed++; else skipped++;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or Win32Exception)
            { skipped++; if (entry.Details.Count < 30) entry.Details.Add($"{backup.Address.Path}: {ex.Message}"); }
        }
        latest = null;
        entry.Summary = $"Реестр: удалено — {changed}, пропущено — {skipped}.";
        journal.Save(entry);
        return new(entry.Summary, changed, skipped, Details: entry.Details);
    }
    public ActionResult Restore(JournalEntry entry)
    {
        if (entry.RegistryBackups.Any(b => !Allowed(b))) throw new ArgumentException("Резервная копия содержит недопустимые разделы.");
        int changed = 0, skipped = 0;
        var details = new List<string>();
        foreach (var backup in entry.RegistryBackups.Where(b => !b.Restored))
        {
            try
            {
                if (store.RestoreIfAbsent(backup)) { backup.Restored = true; changed++; journal.Save(entry); }
                else skipped++;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or Win32Exception)
            { skipped++; if (details.Count < 30) details.Add($"{backup.Address.Path}: {ex.Message}"); }
        }
        entry.Restored = entry.RegistryBackups.All(b => b.Restored);
        journal.Save(entry);
        return new($"Восстановлено записей: {changed}. Конфликты и пропуски: {skipped}.", changed, skipped, Details: details);
    }
}
