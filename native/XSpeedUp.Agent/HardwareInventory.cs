using System.Collections;
using System.Runtime.InteropServices;

namespace XSpeedUp.Agent;

// Read-only SMBIOS inventory. Cache it; heartbeat telemetry must not repeatedly query WMI.
public static class HardwareInventory
{
    public record MemoryModule(string Name, ulong Capacity, uint? ConfiguredMHz, uint? RatedMHz);
    public record Drive(string Name, ulong Bytes, string Connection);
    public record Inventory(string Board, MemoryModule[] Memory, Drive[] Drives);
    public static readonly Lazy<Inventory> Snapshot = new(Read);
    private static List<Dictionary<string, object?>> Query(string table, params string[] fields)
    {
        var result = new List<Dictionary<string, object?>>();
        object? locator = null, service = null, items = null;
        try
        {
            locator = Activator.CreateInstance(Type.GetTypeFromProgID("WbemScripting.SWbemLocator")!);
            service = ((dynamic)locator!).ConnectServer(".", @"root\cimv2");
            items = ((dynamic)service).ExecQuery($"SELECT {string.Join(',', fields)} FROM {table}");
            foreach (object item in (IEnumerable)items)
            {
                try
                {
                    var values = new Dictionary<string, object?>();
                    foreach (var field in fields)
                    {
                        object? property = null;
                        try { property = ((dynamic)item).Properties_.Item(field); values[field] = ((dynamic)property).Value; }
                        finally { Release(property); }
                    }
                    result.Add(values);
                }
                finally { Release(item); }
            }
        }
        catch (Exception ex) when (ex is COMException or ArgumentException or TypeLoadException or Microsoft.CSharp.RuntimeBinder.RuntimeBinderException) { }
        finally { Release(items); Release(service); Release(locator); }
        return result;
    }
    private static void Release(object? value) { if (value is not null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value); }
    private static string Text(Dictionary<string, object?> row, string field) => Convert.ToString(row.GetValueOrDefault(field))?.Trim() ?? "";
    private static uint? Clock(Dictionary<string, object?> row, string field) => uint.TryParse(Text(row, field), out var value) && value > 0 ? value : null;
    private static ulong Size(Dictionary<string, object?> row, string field) => ulong.TryParse(Text(row, field), out var value) ? value : 0;
    private static Inventory Read() => new(
        string.Join(" / ", Query("Win32_BaseBoard", "Manufacturer", "Product").Select(r => Text(r, "Manufacturer") + " " + Text(r, "Product"))),
        Query("Win32_PhysicalMemory", "Manufacturer", "PartNumber", "Capacity", "ConfiguredClockSpeed", "Speed").Select(r => new MemoryModule(Text(r, "Manufacturer") + " " + Text(r, "PartNumber"), Size(r, "Capacity"), Clock(r, "ConfiguredClockSpeed"), Clock(r, "Speed"))).ToArray(),
        Query("Win32_DiskDrive", "Model", "Size", "InterfaceType").Select(r => new Drive(Text(r, "Model"), Size(r, "Size"), Text(r, "InterfaceType"))).ToArray());
}
