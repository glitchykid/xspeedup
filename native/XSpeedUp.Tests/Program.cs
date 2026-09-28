using XSpeedUp.Agent;
using Microsoft.Win32;

var workspace = Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, ".cache", "tests", Guid.NewGuid().ToString("N")));
var root = Path.Combine(workspace, "temp");
var outside = Path.Combine(workspace, "temp-other");
Directory.CreateDirectory(root);
Directory.CreateDirectory(outside);
var journal = new Journal(Path.Combine(workspace, "history"));
var cleanup = new Cleanup([new("test", "Test", "Fixture files only", root, 7)], journal);
int assertions = 0;
void Check(bool value, string message) { if (!value) throw new Exception(message); assertions++; Console.WriteLine("PASS " + message); }
void Reject(Action action, string message)
{
    try { action(); } catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or UnauthorizedAccessException or IOException) { assertions++; Console.WriteLine("PASS " + message); return; }
    throw new Exception(message);
}
string Fixture(string name, bool old = true)
{
    var file = Path.Combine(root, name);
    File.WriteAllText(file, "test fixture content");
    if (old) File.SetLastWriteTimeUtc(file, DateTime.UtcNow.AddDays(-10));
    return file;
}
try
{
    JournalTests.Run(workspace, Check, Reject);
    var old = Fixture("old.tmp");
    var changed = Fixture("changed.tmp");
    var locked = Fixture("locked.tmp");
    var fresh = Fixture("fresh.tmp", false);
    var external = Path.Combine(outside, "keep.tmp");
    File.WriteAllText(external, "never delete this sibling file");
    Check(!Cleanup.IsSafePath(root, external), "Sibling path prefix is rejected");
    Check(!Cleanup.IsSafePath(root, Path.Combine(root, "..", "temp-other", "keep.tmp")), "Traversal outside the cleanup root is rejected");
    Check(!Cleanup.IsSafePath(root, root), "The cleanup root itself cannot be deleted");
    var scan = cleanup.Scan();
    Check(scan.Categories.Single().Files == 3, "Only old files enter the scan manifest");
    Reject(() => cleanup.Apply("wrong-scan", ["test"]), "Unknown scan is rejected");
    Reject(() => cleanup.Apply(scan.Id, ["arbitrary-path"]), "Unknown cleanup category is rejected");
    File.AppendAllText(changed, "changed after scan");
    using (var handle = new FileStream(locked, FileMode.Open, FileAccess.Read, FileShare.None))
    {
        var result = cleanup.Apply(scan.Id, ["test", "test"]);
        Check(result.Changed == 1 && result.Skipped == 2, "Changed and locked files are skipped; duplicates do not execute twice");
        Check(result.Bytes == "test fixture content".Length, "Freed bytes count only successfully deleted files");
    }
    Check(!File.Exists(old) && File.Exists(changed) && File.Exists(fresh) && File.Exists(external), "Only the unchanged old fixture is deleted");
    Reject(() => cleanup.Apply(scan.Id, ["test"]), "A consumed scan cannot be replayed");
    Check(journal.List().Length == 1, "Cleanup writes a persistent audit record");
    var entry = new JournalEntry { Kind = "registry", Summary = "Fixture backup", Backups = [new() { Name = "Fixture", Value = "value", ValueKind = 1 }] };
    journal.Save(entry);
    Check(journal.Read(entry.Id).Backups.Single().Value == "value", "Backup round-trip preserves values");
    Reject(() => journal.Read("../../outside"), "History traversal is rejected");
    Check(RegistryCleaner.ExecutablePath("\"C:\\Program Files\\Example\\app.exe\" --start") == @"C:\Program Files\Example\app.exe", "Quoted executable paths are parsed");
    Check(RegistryCleaner.ExecutablePath(@"C:\Program Files\Example\app.exe --start") is null, "Ambiguous unquoted paths are excluded");
    Check(RegistryCleaner.ExecutablePath(@"\\server\share\app.exe") is null, "Network startup paths are excluded");
    Check(RegistryCleaner.ExecutablePath("rundll32.exe example.dll") is null, "Relative commands are excluded");
    Check(RegistryCleaner.ExecutablePath(@"C:\tools\launcher.cmd") is null, "Non-executable startup commands are excluded");
    Reject(() => new Services(journal).Disable(["WinDefend"]), "Protected services are outside the change catalog");
    var registryJournalPath = Path.Combine(workspace, "registry-history");
    var registryJournal = new Journal(registryJournalPath);
    var store = new MemoryStartupStore();
    store.Set(new("OldApp", @"C:\Missing\app.exe", RegistryValueKind.ExpandString));
    store.Set(new("ChangedApp", @"C:\Missing\changed.exe", RegistryValueKind.String));
    var cleaner = new RegistryCleaner(registryJournal, store, _ => true);
    var registryScan = cleaner.Scan();
    store.Set(new("ChangedApp", @"C:\New\changed.exe", RegistryValueKind.String));
    store.BeforeDelete = () => Check(Directory.EnumerateFiles(registryJournalPath, "*.json").Any(), "Registry backup is persisted before deletion");
    var registryResult = cleaner.Apply(registryScan.Id, registryScan.Entries.Select(e => e.Id).ToArray());
    Check(registryResult.Changed == 1 && registryResult.Skipped == 1, "Changed registry values are preserved");
    var registryBackupId = Path.GetFileNameWithoutExtension(Directory.GetFiles(registryJournalPath, "*.json").Single());
    var registryBackup = registryJournal.Read(registryBackupId);
    store.Set(new("OldApp", "new user value", RegistryValueKind.String));
    Check(cleaner.Restore(registryBackup).Skipped == 1 && store.Get("OldApp")!.Value == "new user value", "Registry restore never overwrites a conflicting value");
    store.BeforeDelete = null;
    store.Delete("OldApp");
    Check(cleaner.Restore(registryBackup).Changed == 1 && store.Get("OldApp")!.Kind == RegistryValueKind.ExpandString, "Registry restore preserves the original unexpanded value type");
    Check(registryJournal.Read(registryBackupId).Restored, "Completed registry restores are persisted");

    var servicesPath = Path.Combine(workspace, "service-history");
    var serviceJournal = new Journal(servicesPath);
    var fakeServices = new MemoryServiceSettings();
    var serviceManager = new Services(serviceJournal, fakeServices);
    fakeServices.BeforeWrite = () => Check(Directory.EnumerateFiles(servicesPath, "*.json").Any(), "Service backup is persisted before changing startup mode");
    Check(serviceManager.Disable(["Fax", "MapsBroker", "Fax"]).Changed == 2, "Service selection applies once per distinct catalog entry");
    fakeServices.BeforeWrite = null;
    var serviceBackupId = Path.GetFileNameWithoutExtension(Directory.GetFiles(servicesPath, "*.json").Single());
    var serviceBackup = serviceJournal.Read(serviceBackupId);
    fakeServices.Modes["Fax"] = 3;
    var restored = serviceManager.Restore(serviceBackup);
    Check(restored.Changed == 1 && restored.Skipped == 1, "Service restore preserves a conflicting external configuration");
    Check(fakeServices.Modes["MapsBroker"] == 3 && fakeServices.Modes["Fax"] == 3, "Service restore reinstates the original mode only where unchanged");
    fakeServices.Modes["Fax"] = 4;
    Check(serviceManager.Restore(serviceBackup).Changed == 1 && serviceJournal.Read(serviceBackupId).Restored, "Partial service restore can be retried safely");
    MaintenanceTests.Run(workspace, Check, Reject);
    Console.WriteLine($"All {assertions} native assertions passed. Fixtures: {workspace}");
}
finally
{
    // Keep test fixtures inside .cache for inspection; no recursive cleanup of computed paths.
}
sealed class MemoryStartupStore : IStartupStore
{
    private readonly Dictionary<string, StartupValue> values = [];
    public Action? BeforeDelete { get; set; }
    public IEnumerable<StartupValue> List() => values.Values.ToArray();
    public StartupValue? Get(string name) => values.GetValueOrDefault(name);
    public void Delete(string name) { BeforeDelete?.Invoke(); values.Remove(name); }
    public void Set(StartupValue value) => values[value.Name] = value;
}
sealed class MemoryServiceSettings : IServiceSettings
{
    public Dictionary<string, uint> Modes { get; } = new() { ["Fax"] = 2, ["MapsBroker"] = 3 };
    public Action? BeforeWrite { get; set; }
    public bool IsAdministrator => true;
    public uint ReadStartMode(string name) => Modes.GetValueOrDefault(name, uint.MaxValue);
    public void WriteStartMode(string name, uint mode) { BeforeWrite?.Invoke(); Modes[name] = mode; }
}
