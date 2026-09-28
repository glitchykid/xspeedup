using Microsoft.Win32;

namespace XSpeedUp.Agent;

public sealed class RegistryCleaner(Journal journal, IStartupStore? startupStore = null, Func<string, bool>? isMissing = null)
{
    public const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private RegistryScan? latest;
    private DateTime scannedAt;
    private readonly Dictionary<string, Backup> values = [];
    private readonly IStartupStore store = startupStore ?? new WindowsStartupStore();
    private readonly Func<string, bool> missing = isMissing ?? DefinitelyMissing;

    public static string? ExecutablePath(string command)
    {
        command = Environment.ExpandEnvironmentVariables(command.Trim());
        string path;
        if (command.StartsWith('"'))
        {
            int closing = command.IndexOf('"', 1);
            if (closing < 2) return null;
            path = command[1..closing];
        }
        else
        {
            // Unquoted commands containing spaces are ambiguous; never guess the executable.
            path = command.Split([' ', '\t'], 2)[0];
        }
        if (!Path.IsPathFullyQualified(path) || !path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) || path.StartsWith(@"\\")) return null;
        return path;
    }

    private static bool DefinitelyMissing(string path)
    {
        try
        {
            var drive = new DriveInfo(Path.GetPathRoot(path)!);
            if (!drive.IsReady || drive.DriveType != DriveType.Fixed) return false;
            _ = File.GetAttributes(path);
            return false;
        }
        catch (FileNotFoundException) { return true; }
        catch (DirectoryNotFoundException) { return true; }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException) { return false; }
    }

    public RegistryScan Scan()
    {
        values.Clear();
        var entries = new List<RegistryEntry>();
        foreach (var item in store.List())
        {
            var (name, value, kind) = item;
            if (kind is not (RegistryValueKind.String or RegistryValueKind.ExpandString)) continue;
            var path = ExecutablePath(value);
            if (path is null || !missing(path)) continue;
            var id = Guid.NewGuid().ToString("N");
            values[id] = new() { Name = name, Value = value, ValueKind = (int)kind };
            entries.Add(new(id, name, "HKEY_CURRENT_USER\\" + RunKey, value, "Исполняемый файл отсутствует на локальном диске."));
        }
        scannedAt = DateTime.UtcNow;
        latest = new(Guid.NewGuid().ToString("N"), entries);
        return latest;
    }

    public ActionResult Apply(string scanId, string[] ids)
    {
        if (latest is null || latest.Id != scanId || DateTime.UtcNow - scannedAt > TimeSpan.FromMinutes(15))
            throw new InvalidOperationException("Анализ реестра устарел. Выполните его заново.");
        if (ids.Length == 0 || ids.Any(id => !values.ContainsKey(id))) throw new ArgumentException("Некорректный выбор записей.");
        var entry = new JournalEntry { Kind = "registry", Summary = "Создана резервная копия записей автозапуска." };
        int changed = 0, skipped = 0;
        foreach (var id in ids.Distinct())
        {
            var backup = values[id];
            var current = store.Get(backup.Name);
            var path = ExecutablePath(backup.Value);
            if (current is null || current.Value != backup.Value || current.Kind != (RegistryValueKind)backup.ValueKind || path is null || !missing(path))
            { skipped++; continue; }
            entry.Backups.Add(backup);
            journal.Save(entry); // Preserve the original type and unexpanded value before deleting.
            try { store.Delete(backup.Name); changed++; }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { skipped++; entry.Details.Add(ex.Message); }
        }
        latest = null;
        entry.Summary = $"Автозапуск: удалено записей — {changed}, пропущено — {skipped}.";
        journal.Save(entry);
        return new(entry.Summary, changed, skipped, Details: entry.Details);
    }

    public ActionResult Restore(JournalEntry entry)
    {
        int changed = 0, conflicts = 0;
        foreach (var backup in entry.Backups.Where(b => !b.Restored))
        {
            if (backup.ValueKind is not ((int)RegistryValueKind.String) and not ((int)RegistryValueKind.ExpandString))
                throw new IOException("Неподдерживаемый тип резервной копии.");
            var existing = store.Get(backup.Name);
            if (existing is not null)
            {
                if (existing.Value == backup.Value && existing.Kind == (RegistryValueKind)backup.ValueKind)
                    backup.Restored = true;
                else conflicts++;
            }
            else
            {
                store.Set(new(backup.Name, backup.Value, (RegistryValueKind)backup.ValueKind));
                backup.Restored = true;
                changed++;
            }
            journal.Save(entry);
        }
        entry.Restored = entry.Backups.All(b => b.Restored);
        journal.Save(entry);
        return new($"Восстановлено записей: {changed}. Конфликты: {conflicts}. Существующие значения сохранены.", changed, conflicts);
    }
}
