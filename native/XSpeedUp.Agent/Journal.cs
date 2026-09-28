namespace XSpeedUp.Agent;

public sealed class Journal(string directory)
{
    public static Journal Create() => new(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "XSpeedUp", "history"));
    private string FileName(string id)
    {
        if (!Guid.TryParseExact(id, "N", out _)) throw new ArgumentException("Некорректный идентификатор копии.");
        return Path.Combine(directory, id + ".json");
    }
    public void Save(JournalEntry entry)
    {
        Directory.CreateDirectory(directory);
        for (string? current = Path.GetFullPath(directory); current is not null; current = Path.GetDirectoryName(current))
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new IOException("Папка копий не должна быть ссылкой.");
        var path = FileName(entry.Id);
        var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        using (var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
        {
            System.Text.Json.JsonSerializer.Serialize(stream, entry, Json.Options);
            stream.Flush(true);
        }
        File.Move(temp, path, true);
    }
    public JournalEntry Read(string id) => System.Text.Json.JsonSerializer.Deserialize<JournalEntry>(File.ReadAllText(FileName(id)), Json.Options)
        ?? throw new IOException("Не удалось прочитать резервную копию.");
    public List<JournalEntry> Entries()
    {
        if (!Directory.Exists(directory)) return [];
        var entries = new List<JournalEntry>();
        foreach (var file in Directory.EnumerateFiles(directory, "*.json"))
        {
            try { entries.Add(Read(Path.GetFileNameWithoutExtension(file))); }
            catch (Exception ex) when (ex is IOException or System.Text.Json.JsonException or ArgumentException) { }
        }
        return entries;
    }
    public object[] List() => Entries().OrderByDescending(e => !e.Restored && (e.Game is not null || e.Tuning is not null))
        .ThenByDescending(e => e.CreatedAt).Take(100).Select(e => (object)new
        { e.Id, e.CreatedAt, e.Kind, e.Summary, e.Restored, e.Details, CanRestore = !e.Restored && (e.Backups.Count > 0 || e.RegistryBackups.Count > 0 || e.Game is not null || e.Tuning is not null) }).ToArray();
}
