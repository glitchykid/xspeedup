using System.Diagnostics;

namespace XSpeedUp.Agent;

public sealed class EmptyFolders(IReadOnlyList<string> roots, Journal journal,
    IReadOnlyList<string>? protectedTrees = null, IReadOnlyList<string>? protectedFolders = null,
    int sliceSteps = 10000) : IDisposable
{
    private sealed class Frame(string path) : IDisposable
    {
        public string Path { get; } = path;
        public IEnumerator<string> Children { get; } = Directory.EnumerateFileSystemEntries(path).GetEnumerator();
        public bool HasChildren { get; set; }
        public void Dispose() => Children.Dispose();
    }
    private readonly Stack<Frame> frames = [];
    private readonly Queue<string> remainingRoots = [];
    private readonly List<FolderCandidate> candidates = [];
    private readonly string[] driveRoots = roots.Select(Path.GetFullPath).ToArray();
    private readonly string[] protectedPaths = (protectedTrees ?? []).Select(Path.GetFullPath).ToArray();
    private readonly string[] protectedExact = (protectedFolders ?? []).Select(Path.GetFullPath).ToArray();
    private static readonly HashSet<string> ExcludedNames = new(StringComparer.OrdinalIgnoreCase)
    { "$Recycle.Bin", "System Volume Information", "Windows", "Windows.old", "Program Files", "Program Files (x86)", "ProgramData", "Recovery", "$WinREAgent", "$WINDOWS.~BT", ".git", ".svn", ".hg", "node_modules" };
    private FolderScan? latest;
    private int visited, skipped;
    private string[] scanRoots = [];
    public static EmptyFolders Create(Journal journal)
    {
        var roots = new List<string>();
        foreach (var drive in DriveInfo.GetDrives())
            try { if (drive.IsReady && drive.DriveType is DriveType.Fixed or DriveType.Removable) roots.Add(drive.RootDirectory.FullName); }
            catch (IOException) { }
        var trees = new[] { Environment.SpecialFolder.Windows, Environment.SpecialFolder.ProgramFiles,
            Environment.SpecialFolder.ProgramFilesX86, Environment.SpecialFolder.CommonApplicationData,
            Environment.SpecialFolder.ApplicationData, Environment.SpecialFolder.LocalApplicationData }
            .Select(Environment.GetFolderPath).Where(p => p.Length > 0).ToArray();
        var exact = new[] { Environment.SpecialFolder.UserProfile, Environment.SpecialFolder.DesktopDirectory,
            Environment.SpecialFolder.MyDocuments, Environment.SpecialFolder.MyMusic, Environment.SpecialFolder.MyPictures,
            Environment.SpecialFolder.MyVideos }.Select(Environment.GetFolderPath).Where(p => p.Length > 0).ToArray();
        return new(roots, journal, trees, exact);
    }
    private static bool Within(string path, string root)
    {
        var relative = Path.GetRelativePath(root, path);
        return !Path.IsPathRooted(relative) && relative != ".." && !relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal);
    }
    private bool Excluded(string path) => protectedPaths.Any(p => Within(path, p)) ||
        path.Split(Path.DirectorySeparatorChar).Any(ExcludedNames.Contains);
    public bool CanRemove(string path) => driveRoots.Any(r => Within(path, r) && !Path.TrimEndingDirectorySeparator(path).Equals(Path.TrimEndingDirectorySeparator(r), StringComparison.OrdinalIgnoreCase))
        && !protectedExact.Any(p => p.Equals(path, StringComparison.OrdinalIgnoreCase)) && !Excluded(path);
    public FolderScan Scan(string? selectedRoot = null)
    {
        var requested = selectedRoot is null ? driveRoots : [Path.TrimEndingDirectorySeparator(Path.GetFullPath(selectedRoot))];
        foreach (var root in requested)
            if (!driveRoots.Any(r => Within(root, r)) || Excluded(root) || Redirected(root) || !Directory.Exists(root))
                throw new ArgumentException("Выберите доступную локальную папку вне защищённых каталогов и ссылок.");
        Dispose();
        scanRoots = requested;
        candidates.Clear(); remainingRoots.Clear(); visited = 0; skipped = 0;
        foreach (var root in scanRoots) remainingRoots.Enqueue(root);
        latest = new(Guid.NewGuid().ToString("N"), DateTime.UtcNow, scanRoots, [], 0, 0, false, true);
        return Continue(latest.Id);
    }
    public FolderScan Continue(string scanId)
    {
        Validate(scanId);
        if (!latest!.CanContinue) throw new InvalidOperationException("Сканирование уже завершено или остановлено.");
        var timer = Stopwatch.StartNew();
        var batch = new List<FolderCandidate>();
        int steps = 0;
        while (timer.Elapsed < TimeSpan.FromSeconds(2) && steps++ < Math.Max(1, sliceSteps))
        {
            if (frames.Count == 0)
            {
                if (!remainingRoots.TryDequeue(out var root)) break;
                try { if (!Redirected(root) && !Excluded(root)) frames.Push(new(root)); else skipped++; }
                catch (Exception ex) when (Expected(ex)) { skipped++; }
                continue;
            }
            var frame = frames.Peek();
            bool hasNext;
            try { hasNext = frame.Children.MoveNext(); }
            catch (Exception ex) when (Expected(ex))
            { skipped++; frames.Pop().Dispose(); continue; }
            if (!hasNext)
            {
                frames.Pop(); frame.Dispose(); visited++;
                try
                {
                    if (!frame.HasChildren && RemovableInScan(frame.Path) && !Redirected(frame.Path))
                    { var candidate = Native.InspectDirectory(frame.Path); candidates.Add(candidate); batch.Add(candidate); }
                }
                catch (Exception ex) when (Expected(ex)) { skipped++; }
                continue;
            }
            try
            {
                frame.HasChildren = true;
                var path = frame.Children.Current;
                var attributes = File.GetAttributes(path);
                if ((attributes & FileAttributes.Directory) == 0) continue;
                if (Excluded(path) || (attributes & (FileAttributes.ReparsePoint | FileAttributes.System)) != 0)
                { skipped++; continue; }
                frames.Push(new(path));
            }
            catch (Exception ex) when (Expected(ex)) { skipped++; }
        }
        bool complete = frames.Count == 0 && remainingRoots.Count == 0;
        latest = latest! with { CreatedAt = DateTime.UtcNow, Entries = batch, Visited = visited,
            Skipped = skipped, Complete = complete, CanContinue = !complete };
        return latest;
    }
    private static bool Expected(Exception ex) => ex is IOException or UnauthorizedAccessException or System.ComponentModel.Win32Exception;
    private bool RemovableInScan(string path) => CanRemove(path) && scanRoots.Any(r => Within(path, r))
        && !scanRoots.Any(r => Path.TrimEndingDirectorySeparator(path).Equals(Path.TrimEndingDirectorySeparator(r), StringComparison.OrdinalIgnoreCase));
    public FolderScan Cancel(string id)
    {
        Validate(id); Dispose(); remainingRoots.Clear();
        latest = latest! with { CanContinue = false, Entries = candidates.ToList() };
        return latest;
    }
    public ActionResult ApplyAll(string scanId) => Apply(scanId, candidates.Select(c => c.Id).ToArray());
    private static bool Redirected(string path)
    {
        for (string? current = path; current is not null; current = Path.GetDirectoryName(current))
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) return true;
        return false;
    }
    private void Validate(string id)
    {
        if (latest is null || latest.Id != id || DateTime.UtcNow - latest.CreatedAt > TimeSpan.FromMinutes(15))
            throw new InvalidOperationException("Анализ папок устарел. Начните поиск заново.");
    }
    public ActionResult Apply(string scanId, string[] ids)
    {
        Validate(scanId);
        if (!latest!.Complete) throw new InvalidOperationException("Дождитесь полного сканирования.");
        var byId = candidates.ToDictionary(c => c.Id);
        if (ids.Length == 0 || ids.Any(id => !byId.ContainsKey(id)))
            throw new ArgumentException("Некорректный выбор папок.");
        Dispose();
        var entry = new JournalEntry { Kind = "folders", Summary = "Удаление выбранных пустых папок начато." };
        journal.Save(entry);
        int changed = 0, skipped = 0;
        foreach (var id in ids.Distinct())
        {
            var candidate = byId[id];
            try
            {
                if (!RemovableInScan(candidate.Path) || Redirected(candidate.Path)) throw new IOException("Папка защищена или перенаправлена.");
                Native.DeleteEmptyDirectory(candidate);
                changed++;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
            { skipped++; if (entry.Details.Count < 30) entry.Details.Add($"{candidate.Path}: {ex.Message}"); }
        }
        latest = null;
        entry.Summary = $"Удалено пустых папок: {changed}. Пропущено: {skipped}.";
        journal.Save(entry);
        return new(entry.Summary, changed, skipped, Details: entry.Details);
    }
    public void Dispose() { while (frames.TryPop(out var frame)) frame.Dispose(); }
}
