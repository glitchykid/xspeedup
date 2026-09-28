using System.Diagnostics;

namespace XSpeedUp.Agent;

public sealed class Cleanup(IReadOnlyList<CleanupRoot> roots, Journal journal)
{
    private readonly Dictionary<string, List<FileCandidate>> candidates = [];
    private CleanupScan? latest;
    private const int MaxEntries = 50000;

    public static Cleanup Create(Journal journal)
    {
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return new Cleanup([
            new("temp", "Временные файлы", "Файлы в вашей папке Temp старше 7 дней. Занятые файлы пропускаются.", Path.Combine(local, "Temp"), 7),
            new("shader", "Кэш шейдеров DirectX", "Кэш старше 7 дней. Игры создадут его заново; первый запуск может быть медленнее.", Path.Combine(local, "D3DSCache"), 7),
            new("crash", "Дампы сбоев", "Отчёты CrashDumps старше 14 дней. После удаления они недоступны для диагностики.", Path.Combine(local, "CrashDumps"), 14)
        ], journal);
    }

    public static bool IsSafePath(string root, string path)
    {
        root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
        path = Path.GetFullPath(path);
        if (!path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return false;
        // Check all ancestors, including ancestors above the cleanup root.
        for (string? current = path; current is not null; current = Path.GetDirectoryName(current))
        {
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) return false;
        }
        return true;
    }

    public CleanupScan Scan()
    {
        candidates.Clear();
        var result = new CleanupScan(Guid.NewGuid().ToString("N"), DateTime.UtcNow, [], false);
        int visited = 0;
        var timer = Stopwatch.StartNew();
        foreach (var root in roots)
        {
            var files = new List<FileCandidate>();
            int skipped = 0;
            candidates[root.Id] = files;
            if (Directory.Exists(root.Path))
            {
                var directories = new Stack<string>();
                directories.Push(root.Path);
                while (directories.Count > 0 && visited < MaxEntries && timer.Elapsed < TimeSpan.FromSeconds(20))
                {
                    var directory = directories.Pop();
                    try
                    {
                        // The synthetic child validates the root itself without following a junction.
                        if (directory != root.Path && !IsSafePath(root.Path, directory)) { skipped++; continue; }
                        if (HasRedirectedAncestor(directory)) { skipped++; continue; }
                        foreach (var entry in Directory.EnumerateFileSystemEntries(directory))
                        {
                            if (++visited > MaxEntries || timer.Elapsed > TimeSpan.FromSeconds(20)) break;
                            try
                            {
                                var attributes = File.GetAttributes(entry);
                                if ((attributes & FileAttributes.ReparsePoint) != 0) { skipped++; continue; }
                                if ((attributes & FileAttributes.Directory) != 0) { directories.Push(entry); continue; }
                                var file = new FileInfo(entry);
                                if (file.LastWriteTimeUtc > result.CreatedAt.AddDays(-root.MinimumAgeDays)) continue;
                                files.Add(new(file.FullName, file.Length, file.LastWriteTimeUtc));
                            }
                            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { skipped++; }
                        }
                    }
                    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { skipped++; }
                }
            }
            result.Categories.Add(new(root.Id, root.Name, root.Description, files.Count, files.Sum(f => f.Bytes), skipped, files.Take(5).Select(f => f.Path).ToArray()));
        }
        latest = result with { Truncated = visited >= MaxEntries || timer.Elapsed >= TimeSpan.FromSeconds(20) };
        return latest;
    }

    private static bool HasRedirectedAncestor(string directory)
    {
        for (string? current = directory; current is not null; current = Path.GetDirectoryName(current))
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) return true;
        return false;
    }

    public ActionResult Apply(string scanId, string[] ids)
    {
        if (latest is null || latest.Id != scanId || DateTime.UtcNow - latest.CreatedAt > TimeSpan.FromMinutes(15))
            throw new InvalidOperationException("Анализ устарел. Выполните его заново.");
        if (ids.Length == 0 || ids.Any(id => !candidates.ContainsKey(id))) throw new ArgumentException("Некорректный выбор очистки.");
        var entry = new JournalEntry { Kind = "cleanup", Summary = "Очистка начата. Файлы удаляются без возможности восстановления." };
        journal.Save(entry); // A writable audit log is required before the first deletion.
        int changed = 0, skipped = 0;
        long bytes = 0;
        var details = new List<string>();
        foreach (var id in ids.Distinct())
        {
            var root = roots.Single(r => r.Id == id);
            foreach (var file in candidates[id])
            {
                try
                {
                    if (!IsSafePath(root.Path, file.Path)) throw new IOException("Перенаправленный путь.");
                    Native.DeleteVerified(file);
                    bytes += file.Bytes;
                    changed++;
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
                {
                    skipped++;
                    if (details.Count < 30) details.Add($"{file.Path}: {ex.Message}");
                }
            }
        }
        latest = null;
        entry.Summary = $"Удалено файлов: {changed}; пропущено: {skipped}. Освобождено: {bytes:N0} байт.";
        entry.Details = details;
        journal.Save(entry);
        return new(entry.Summary, changed, skipped, bytes, details);
    }
}
