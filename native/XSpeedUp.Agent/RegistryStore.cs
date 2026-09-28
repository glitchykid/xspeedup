using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;
using System.ComponentModel;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace XSpeedUp.Agent;

public record RegistryAddress(string Hive, int View, string Path);
public record RegistryDatum(string Name, int Kind, string Data)
{
    public object Decode() => (RegistryValueKind)Kind switch
    {
        RegistryValueKind.String or RegistryValueKind.ExpandString => Data,
        RegistryValueKind.DWord => int.Parse(Data, CultureInfo.InvariantCulture),
        RegistryValueKind.QWord => long.Parse(Data, CultureInfo.InvariantCulture),
        RegistryValueKind.Binary or RegistryValueKind.None => Convert.FromBase64String(Data),
        RegistryValueKind.MultiString => JsonSerializer.Deserialize<string[]>(Data) ?? throw new IOException("Invalid multi-string backup."),
        _ => throw new IOException("Unsupported registry type.")
    };
}
public record RegistrySnapshot(RegistryDatum[] Values, string[] Children)
{
    public string? Text(string name) => Values.FirstOrDefault(v => v.Name.Equals(name, StringComparison.OrdinalIgnoreCase)
        && v.Kind is 1 or 2)?.Data;
    public bool Has(string name) => Values.Any(v => v.Name.Equals(name, StringComparison.OrdinalIgnoreCase));
    public bool Empty => Values.Length == 0 && Children.Length == 0;
    public bool Same(RegistrySnapshot other) => Values.SequenceEqual(other.Values) && Children.SequenceEqual(other.Children);
}
public sealed class RegistryBackup
{
    public RegistryAddress Address { get; set; } = new("HKCU", 64, "");
    public string? ValueName { get; set; }
    public RegistrySnapshot Snapshot { get; set; } = new([], []);
    public bool Restored { get; set; }
}
public interface IRegistryStore
{
    RegistrySnapshot? Read(RegistryAddress address);
    bool DeleteIfUnchanged(RegistryBackup backup);
    bool RestoreIfAbsent(RegistryBackup backup);
}

public sealed class WindowsRegistryStore : IRegistryStore
{
    private static RegistryKey Base(RegistryAddress a)
    {
        using var root = RegistryKey.OpenBaseKey(a.Hive switch
        { "HKCU" => RegistryHive.CurrentUser, "HKLM" => RegistryHive.LocalMachine, _ => throw new ArgumentException("Invalid hive.") },
            a.View == 64 ? RegistryView.Registry64 : a.View == 32 ? RegistryView.Registry32 : throw new ArgumentException("Invalid registry view."));
        // Handle on a predefined root requests write access. Open an ordinary read-only handle first.
        return root.OpenSubKey("", false) ?? throw new IOException("Registry root is unavailable.");
    }
    private static void Error(int result) { if (result != 0) throw new Win32Exception(result); }
    private static RegistryKey? OpenChecked(RegistryAddress address)
    {
        RegistryKey? current = Base(address);
        try
        {
            foreach (var part in address.Path.Split('\\'))
            {
                if (part.Length == 0) throw new ArgumentException("Empty key segment.");
                int result = RegOpenKeyEx(current.Handle, part, 8, 0x20019 | address.ViewFlag(), out var handle);
                if (result == 2) { handle?.Dispose(); return null; }
                Error(result);
                var next = RegistryKey.FromHandle(handle, (RegistryView)address.ViewFlag());
                current.Dispose(); current = next;
                uint type = 0, size = 0;
                int query = RegQueryValueEx(current.Handle, "SymbolicLinkValue", IntPtr.Zero, ref type, IntPtr.Zero, ref size);
                if (query == 0 && type == 6) throw new IOException("Registry links are excluded.");
                if (query != 0 && query != 2) Error(query);
            }
            var key = current; current = null; return key;
        }
        finally { current?.Dispose(); }
    }
    private static RegistrySnapshot Snapshot(RegistryKey key)
    {
        var names = key.GetValueNames();
        if (names.Length > 512) throw new IOException("Registry entry is too large to back up.");
        var values = new List<RegistryDatum>();
        foreach (var name in names.Order(StringComparer.OrdinalIgnoreCase))
        {
            var kind = key.GetValueKind(name);
            var value = key.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames);
            string data = kind switch
            {
                RegistryValueKind.String or RegistryValueKind.ExpandString => (string)value!,
                RegistryValueKind.DWord when value is int number => number.ToString(CultureInfo.InvariantCulture),
                RegistryValueKind.QWord when value is long number => number.ToString(CultureInfo.InvariantCulture),
                RegistryValueKind.Binary or RegistryValueKind.None => Convert.ToBase64String((byte[])value!),
                RegistryValueKind.MultiString => JsonSerializer.Serialize((string[])value!),
                _ => throw new IOException("Registry value type is unsupported; key was skipped.")
            };
            if (data.Length > 262144) throw new IOException("Registry value is too large to back up.");
            values.Add(new(name, (int)kind, data));
        }
        return new(values.ToArray(), key.GetSubKeyNames().Order(StringComparer.OrdinalIgnoreCase).ToArray());
    }
    public RegistrySnapshot? Read(RegistryAddress address)
    {
        using var key = OpenChecked(address);
        return key is null ? null : Snapshot(key);
    }
    private static SafeFileHandle Transaction()
    {
        var transaction = CreateTransaction(IntPtr.Zero, IntPtr.Zero, 0, 0, 0, 0, null);
        if (transaction.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        return transaction;
    }
    private static RegistryKey? OpenTransacted(RegistryAddress address, SafeFileHandle transaction)
    {
        using var check = OpenChecked(address);
        if (check is null) return null;
        using var root = Base(address);
        int result = RegOpenKeyTransacted(root.Handle, address.Path, 0, 0x2001f | address.ViewFlag(),
            out var handle, transaction, IntPtr.Zero);
        if (result == 2) { handle?.Dispose(); return null; }
        Error(result);
        return RegistryKey.FromHandle(handle, (RegistryView)address.ViewFlag());
    }
    private static void Commit(SafeFileHandle transaction)
    { if (!CommitTransaction(transaction)) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    public bool DeleteIfUnchanged(RegistryBackup backup)
    {
        using var transaction = Transaction();
        using var key = OpenTransacted(backup.Address, transaction);
        if (key is null) return false;
        var current = Snapshot(key);
        if (backup.ValueName is { } name)
        {
            var expected = backup.Snapshot.Values.Single();
            if (current.Values.FirstOrDefault(v => v.Name == name) != expected) return false;
            key.DeleteValue(name, true);
        }
        else
        {
            if (!current.Same(backup.Snapshot) || current.Children.Length != 0) return false;
            using var root = Base(backup.Address);
            Error(RegDeleteKeyTransacted(root.Handle, backup.Address.Path, backup.Address.ViewFlag(), 0, transaction, IntPtr.Zero));
        }
        Commit(transaction);
        return true;
    }
    public bool RestoreIfAbsent(RegistryBackup backup)
    {
        // Refuse malformed backups before opening a writable registry handle.
        foreach (var datum in backup.Snapshot.Values) _ = datum.Decode();
        using var transaction = Transaction();
        using var key = OpenTransacted(backup.Address, transaction);
        if (key is not null)
        {
            var existing = Snapshot(key);
            if (backup.ValueName is null) return existing.Same(backup.Snapshot);
            var datum = backup.Snapshot.Values.Single();
            var value = existing.Values.FirstOrDefault(v => v.Name == datum.Name);
            if (value is not null) return value == datum;
            key.SetValue(datum.Name, datum.Decode(), (RegistryValueKind)datum.Kind);
        }
        else
        {
            // Recreate only the reviewed leaf, never a missing chain of parent keys.
            int separator = backup.Address.Path.LastIndexOf('\\');
            using var parent = OpenTransacted(backup.Address with { Path = backup.Address.Path[..separator] }, transaction);
            if (parent is null) return false;
            Error(RegCreateKeyTransacted(parent.Handle, backup.Address.Path[(separator + 1)..], 0, null, 0,
                0x2001f | backup.Address.ViewFlag(), IntPtr.Zero, out var handle, out var disposition, transaction, IntPtr.Zero));
            using var created = RegistryKey.FromHandle(handle, (RegistryView)backup.Address.ViewFlag());
            if (disposition != 1) return false;
            foreach (var datum in backup.Snapshot.Values) created.SetValue(datum.Name, datum.Decode(), (RegistryValueKind)datum.Kind);
        }
        Commit(transaction);
        return true;
    }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern int RegOpenKeyEx(SafeRegistryHandle key, string name, uint options, int access, out SafeRegistryHandle result);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern int RegQueryValueEx(SafeRegistryHandle key, string name, IntPtr reserved, ref uint type, IntPtr data, ref uint size);
    [DllImport("KtmW32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateTransaction(IntPtr attributes, IntPtr guid, uint options, uint isolation, uint flags, uint timeout, string? description);
    [DllImport("KtmW32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CommitTransaction(SafeFileHandle transaction);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern int RegOpenKeyTransacted(SafeRegistryHandle key, string name, uint options, int access, out SafeRegistryHandle result, SafeFileHandle transaction, IntPtr extended);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern int RegDeleteKeyTransacted(SafeRegistryHandle key, string name, int access, uint reserved, SafeFileHandle transaction, IntPtr extended);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern int RegCreateKeyTransacted(SafeRegistryHandle key, string name, uint reserved, string? keyClass, uint options, int access, IntPtr security, out SafeRegistryHandle result, out uint disposition, SafeFileHandle transaction, IntPtr extended);
}
internal static class RegistryAddressExtensions
{
    public static int ViewFlag(this RegistryAddress address) => address.View == 64 ? 0x100 : 0x200;
}
