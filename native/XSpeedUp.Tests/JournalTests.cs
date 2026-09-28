using XSpeedUp.Agent;

internal static class JournalTests
{
    public static void Run(string workspace, Action<bool, string> check, Action<Action, string> reject)
    {
        var directory = Path.Combine(workspace, "journal-locks");
        var journal = new Journal(directory); var entry = new JournalEntry { Summary = "Original" };
        journal.Save(entry);
        var path = Path.Combine(directory, entry.Id + ".json");
        var held = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        var release = Task.Run(() => { Thread.Sleep(150); held.Dispose(); });
        entry.Summary = "Updated";
        try { journal.Save(entry); }
        finally { release.GetAwaiter().GetResult(); }
        check(journal.Read(entry.Id).Summary == "Updated", "Atomic journal replacement survives a brief Windows file lock");
        using (var permanent = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            entry.Summary = "Must not replace";
            reject(() => journal.Save(entry), "A persistent file lock remains a failed journal commit");
            check(journal.Read(entry.Id).Summary == "Updated", "Failed journal replacement preserves the previous record");
        }
        check(!Directory.EnumerateFiles(directory, "*.tmp").Any(), "Failed atomic journal writes leave no abandoned temporary file");
    }
}
