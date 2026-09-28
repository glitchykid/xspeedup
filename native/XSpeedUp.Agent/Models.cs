using System.Text.Json;

namespace XSpeedUp.Agent;

public static class Json
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web) { WriteIndented = false };
    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);
}
public record ActionResult(string Message, int Changed, int Skipped = 0, long Bytes = 0, List<string>? Details = null);
public record CleanupRoot(string Id, string Name, string Description, string Path, int MinimumAgeDays);
public record FileCandidate(string Path, long Bytes, DateTime ModifiedUtc);
public record CleanupCategory(string Id, string Name, string Description, int Files, long Bytes, int Skipped, string[] Samples);
public record CleanupScan(string Id, DateTime CreatedAt, List<CleanupCategory> Categories, bool Truncated);
public record RegistryEntry(string Id, string Name, string Key, string Value, string Reason, bool CanChange = true);
public record RegistryScan(string Id, List<RegistryEntry> Entries, bool Truncated = false, List<string>? Warnings = null);
public record FolderCandidate(string Id, string Path, DateTime CreatedUtc, ulong Identity, uint Volume);
public record FolderScan(string Id, DateTime CreatedAt, string[] Roots, List<FolderCandidate> Entries,
    int Visited, int Skipped, bool Complete, bool CanContinue);
public record ServiceDefinition(string Id, string Name, string Description, string Impact, string[] Profiles);
public record ServiceItem(string Id, string Name, string Description, string Impact, string[] Profiles,
    bool Installed, string Status, uint StartMode, bool CanChange);
public record ProcessItem(int Id, string Name, long Memory, string Title, string StartTime);
public record GameService(string Id, uint State, bool CanStop);
public record GameStatus(string? SessionId, int? WindowsMode, bool SettingAvailable, GameService[] Services);
public record GameProcess(int Id, string StartTime);
public sealed class GameBackup
{
    public int? OriginalMode { get; set; }
    public bool RestoreMode { get; set; }
    public List<string> StoppedServices { get; set; } = [];
}
public sealed class TuningBackup
{
    public int StepSeconds { get; set; } = 45;
    public string Device { get; set; } = "";
    public int OriginalCore { get; set; }
    public int? OriginalMemory { get; set; }
    public int ExpectedCore { get; set; }
    public int? ExpectedMemory { get; set; }
    public int PreviousCore { get; set; }
    public int? PreviousMemory { get; set; }
    public int PassedCore { get; set; }
    public int? PassedMemory { get; set; }
    public int Stage { get; set; }
    public DateTime Heartbeat { get; set; }
    public DateTime StageStarted { get; set; }
    public bool Completed { get; set; }
}
public record TuningState(string Id, int Stage, int Core, int? Memory, int Temperature, bool More);
public sealed class Backup
{
    public string Name { get; set; } = "";
    public string Value { get; set; } = "";
    public int ValueKind { get; set; }
    public uint StartMode { get; set; }
    public bool Restored { get; set; }
}
public sealed class JournalEntry
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string Kind { get; set; } = "";
    public string Summary { get; set; } = "";
    public bool Restored { get; set; }
    public List<string> Details { get; set; } = [];
    public List<Backup> Backups { get; set; } = [];
    public List<RegistryBackup> RegistryBackups { get; set; } = [];
    public GameBackup? Game { get; set; }
    public TuningBackup? Tuning { get; set; }
}
