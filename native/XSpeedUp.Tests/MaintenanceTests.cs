using XSpeedUp.Agent;

internal static class MaintenanceTests
{
    public static void Run(string workspace, Action<bool, string> check, Action<Action, string> reject)
    {
        check(new WindowsRegistryStore().Read(new("HKLM", 64, "Software")) is not null,
            "Machine registry inspection works through read-only handles");
        var folderRoot = Path.Combine(workspace, "empty-folder-fixtures");
        Directory.CreateDirectory(folderRoot);
        var empty = Directory.CreateDirectory(Path.Combine(folderRoot, "empty")).FullName;
        var changed = Directory.CreateDirectory(Path.Combine(folderRoot, "changed")).FullName;
        var replaced = Directory.CreateDirectory(Path.Combine(folderRoot, "replaced")).FullName;
        var nested = Directory.CreateDirectory(Path.Combine(folderRoot, "parent", "leaf")).FullName;
        var protectedRoot = Directory.CreateDirectory(Path.Combine(folderRoot, "protected")).FullName;
        Directory.CreateDirectory(Path.Combine(protectedRoot, "empty"));
        var folderJournal = new Journal(Path.Combine(workspace, "folder-journal"));
        using var folders = new EmptyFolders([folderRoot], folderJournal, [protectedRoot]);
        var scan = folders.Scan();
        check(scan.Complete && scan.Entries.Count == 4, "Folder scan finds only empty leaves outside protected roots");
        check(!folders.CanRemove(folderRoot) && !folders.CanRemove(protectedRoot), "Folder scan roots and protected directories cannot be removed");
        reject(() => folders.Apply(scan.Id, ["unknown"]), "Unknown folder IDs cannot authorize deletion");
        reject(() => folders.Continue("stale"), "Unknown continuation token is rejected");
        File.WriteAllText(Path.Combine(changed, "keep.txt"), "created after scan");
        Directory.Move(replaced, replaced + "-original");
        Directory.CreateDirectory(replaced);
        var result = folders.Apply(scan.Id, scan.Entries.Select(e => e.Id).ToArray());
        check(result.Changed == 2 && result.Skipped == 2, "Nonempty and replaced directories are rejected at deletion time");
        check(File.Exists(Path.Combine(changed, "keep.txt")) && Directory.Exists(replaced), "New contents and replacement folder survive");
        check(!Directory.Exists(empty) && !Directory.Exists(nested) && Directory.Exists(Path.GetDirectoryName(nested)), "Folder deletion never recursively removes parents");
        reject(() => folders.Apply(scan.Id, [scan.Entries[0].Id]), "Consumed folder scan cannot be replayed");
        var secondScan = folders.Scan();
        check(secondScan.Entries.Any(e => e.Path == Path.GetDirectoryName(nested)), "A later scan discovers a parent that has become empty");

        var registryPath = Path.Combine(workspace, "extended-registry-journal");
        var registryJournal = new Journal(registryPath);
        var store = new FakeRegistry();
        var stale = new RegistryAddress("HKCU", 64, RegistryMaintenance.Uninstall + "\\RemovedApp");
        var live = stale with { Path = RegistryMaintenance.Uninstall + "\\LiveApp" };
        var appPath = stale with { Path = RegistryMaintenance.AppPaths + "\\removed.exe" };
        var emptyKey = stale with { Path = "Software\\ExampleVendor\\EmptyApp" };
        RegistryDatum Text(string name, string data) => new(name, 1, data);
        RegistrySnapshot Installation(string location) => new([Text("DisplayName", "Example"), Text("InstallLocation", location), Text("UninstallString", @"C:\gone\uninstall.exe"), new("Flags", 4, "-1"), new("Blob", 3, "AAECAw=="), new("List", 7, "[\"one\",\"two\"]")], []);
        store.Values[stale] = Installation(@"C:\gone");
        store.Values[live] = Installation(@"C:\live");
        store.Values[appPath] = new([Text("", @"C:\gone\removed.exe")], []);
        store.Values[emptyKey] = new([], []);
        var manager = new RegistryMaintenance(registryJournal, store, p => p.StartsWith(@"C:\gone", StringComparison.Ordinal));
        var registryScan = manager.Scan();
        check(registryScan.Entries.Count == 3, "Extended registry scan finds stale uninstall, App Paths and empty vendor keys but keeps installed apps");
        store.Values[appPath] = new([Text("", @"C:\live\replacement.exe")], []);
        store.BeforeDelete = () => check(Directory.GetFiles(registryPath, "*.json").Length > 0, "Extended registry backup is persisted before deletion");
        var applied = manager.Apply(registryScan.Id, registryScan.Entries.Select(e => e.Id).ToArray());
        check(applied.Changed == 2 && applied.Skipped == 1, "Registry changes since the scan are preserved");
        reject(() => manager.Apply(registryScan.Id, [registryScan.Entries[0].Id]), "Extended registry scan is single-use");
        var backupFile = Directory.GetFiles(registryPath, "*.json").Single();
        var backup = registryJournal.Read(Path.GetFileNameWithoutExtension(backupFile));
        check(backup.RegistryBackups.Single(b => b.Address == stale).Snapshot.Values.Single(v => v.Name == "Blob").Decode() is byte[] { Length: 4 }, "Typed registry snapshots preserve binary values through the journal");
        store.Values[stale] = Installation(@"C:\live");
        var restored = manager.Restore(backup);
        check(restored.Changed == 1 && restored.Skipped == 2, "Registry restore recreates empty keys and preserves conflicting application keys");
        store.Values.Remove(stale);
        var retry = manager.Restore(backup);
        check(retry.Changed == 1 && store.Values[stale].Values.Single(v => v.Name == "Flags").Decode() is int number && number == -1, "Registry restore retries preserve original numeric types");
        var systemBackup = new RegistryBackup { Address = new("HKLM", 64, @"SYSTEM\CurrentControlSet\Services\WinDefend"), Snapshot = new([], []) };
        check(!RegistryMaintenance.Allowed(systemBackup), "System registry keys cannot enter restore scope");
        reject(() => manager.Restore(new() { RegistryBackups = [systemBackup] }), "Out-of-scope backup restore is rejected");
        var testBackup = new RegistryBackup { Address = stale, Snapshot = Installation(@"C:\gone") with { Children = ["Nested"] } };
        check(manager.Reason(testBackup) is null, "Registry trees with subkeys are excluded from leaf deletion");
        testBackup.Snapshot = new([.. Installation(@"C:\gone").Values, new("WindowsInstaller", 4, "1")], []);
        check(manager.Reason(testBackup) is null, "MSI metadata is excluded from stale application heuristics");
        testBackup.Snapshot = Installation(@"C:\gone") with { Values = [Text("DisplayName", "Unknown"), Text("InstallLocation", @"C:\gone")] };
        check(manager.Reason(testBackup) is null, "A missing installation directory alone does not prove an app was removed");
        testBackup.Snapshot = new([.. Installation(@"C:\gone").Values, Text("DisplayIcon", @"C:\live\icon.exe,0")], []);
        check(manager.Reason(testBackup) is null, "An existing additional executable reference prevents cleanup");

        var memoryPath = Path.Combine(workspace, "memory-journal");
        var memory = new FakeMemory();
        var memoryCleaner = new MemoryCleaner(new(memoryPath), _ => memory);
        memory.BeforeTrim = () => check(Directory.GetFiles(memoryPath, "*.json").Length == 1, "Memory action is journaled before trimming");
        reject(() => memoryCleaner.Release(1, "wrong"), "Reused process identity cannot authorize memory trimming");
        check(!memory.Trimmed, "Rejected memory request never reaches the OS adapter");
        memory.Eligible = false;
        reject(() => memoryCleaner.Release(1, "start"), "Ineligible processes cannot be trimmed");
        memory.Eligible = true;
        check(memoryCleaner.Release(1, "start").Bytes == 600 && memory.Trimmed, "Memory result measures working-set reduction without closing the app");
    }
    private sealed class FakeRegistry : IRegistryStore
    {
        public Dictionary<RegistryAddress, RegistrySnapshot> Values { get; } = [];
        public Action? BeforeDelete { get; set; }
        public RegistrySnapshot? Read(RegistryAddress address)
        {
            if (Values.TryGetValue(address, out var value)) return value;
            var prefix = address.Path + "\\";
            var children = Values.Keys.Where(a => a.Hive == address.Hive && a.View == address.View && a.Path.StartsWith(prefix, StringComparison.Ordinal))
                .Select(a => a.Path[prefix.Length..].Split('\\')[0]).Distinct().Order().ToArray();
            return children.Length == 0 ? null : new([], children);
        }
        public bool DeleteIfUnchanged(RegistryBackup backup)
        {
            BeforeDelete?.Invoke();
            if (Read(backup.Address) is not { } current || !current.Same(backup.Snapshot)) return false;
            Values.Remove(backup.Address); return true;
        }
        public bool RestoreIfAbsent(RegistryBackup backup)
        {
            if (Read(backup.Address) is { } current) return current.Same(backup.Snapshot);
            Values[backup.Address] = backup.Snapshot; return true;
        }
    }
    private sealed class FakeMemory : IMemoryTarget
    {
        public bool Eligible { get; set; } = true;
        public string StartTime => "start";
        public string Name => "Fixture";
        public long WorkingSet => Trimmed ? 400 : 1000;
        public bool Trimmed { get; private set; }
        public Action? BeforeTrim { get; set; }
        public void Trim() { BeforeTrim?.Invoke(); Trimmed = true; }
        public void Dispose() { }
    }
}
