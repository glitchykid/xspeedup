using System.Runtime.InteropServices;
using System.Text;

namespace XSpeedUp.Agent;

public record ClockRange(int Current, int Minimum, int Maximum);
public record GpuTelemetry(uint? CoreMHz, uint? MemoryMHz, uint? MaxCoreMHz, uint? MaxMemoryMHz, double? Watts, double? PowerLimitWatts);
public record GpuCapability(string Id, string Name, int? Temperature, ClockRange? Core, ClockRange? Memory, bool CanTune, string Reason, GpuTelemetry? Telemetry = null);
public interface IGpuClocks
{
    GpuCapability[] Discover();
    int Temperature(string id);
    ClockRange Read(string id, int domain);
    void Write(string id, int domain, int offset);
}
public sealed class NvidiaClocks : IGpuClocks
{
    private static bool initialized;
    private static readonly object initialization = new();
    private static void Ensure() { lock (initialization) { if (!initialized) { Check(Init()); initialized = true; } } }
    [StructLayout(LayoutKind.Sequential)]
    private struct Offset { public uint Version, Type, Pstate; public int Current, Minimum, Maximum; }
    private static void Check(int result) { if (result != 0) throw new IOException($"NVML returned {result}: unsupported feature, permissions or device unavailable."); }
    private static IntPtr Device(string id)
    {
        Ensure(); Check(Handle(id, out var handle)); return handle;
    }
    public GpuCapability[] Discover()
    {
        var result = new List<GpuCapability>();
        try
        {
            Ensure(); Check(Count(out var count));
            for (uint i = 0; i < Math.Min(count, 16); i++)
            {
                Check(At(i, out var device)); var name = new StringBuilder(128); var uuid = new StringBuilder(96);
                Check(Name(device, name, (uint)name.Capacity)); Check(Uuid(device, uuid, (uint)uuid.Capacity));
                ClockRange? core = null, memory = null; int? temperature = null; string reason = "";
                try { core = Read(uuid.ToString(), 0); } catch (Exception ex) when (Unavailable(ex)) { reason = ex.Message; }
                try { memory = Read(uuid.ToString(), 2); } catch (Exception ex) when (Unavailable(ex)) { reason = ex.Message; }
                try { temperature = Temperature(uuid.ToString()); } catch (Exception ex) when (Unavailable(ex)) { reason = ex.Message; }
                bool supported = core is not null && core.Maximum >= core.Current + 15 && temperature is not null;
                if (!Services.IsAdmin) reason = "Administrator rights are required for clock writes.";
                uint? Query(Func<uint?> query) { try { return query(); } catch (Exception ex) when (Unavailable(ex)) { return null; } }
                uint? Clock(uint domain, bool maximum) => Query(() => { uint value; int code = maximum ? MaxClock(device, domain, out value) : CurrentClock(device, domain, out value); return code == 0 ? value : null; });
                var power = Query(() => Power(device, out var value) == 0 ? value : null);
                var limit = Query(() => PowerLimit(device, out var value) == 0 ? value : null);
                result.Add(new(uuid.ToString(), name.ToString(), temperature, core, memory, supported && Services.IsAdmin, reason,
                    new(Clock(0, false), Clock(2, false), Clock(0, true), Clock(2, true), power / 1000.0, limit / 1000.0)));
            }
        }
        catch (Exception ex) when (Unavailable(ex)) { if (result.Count == 0) result.Add(new("", "NVIDIA NVML", null, null, null, false, ex.Message)); }
        return result.ToArray();
    }
    public static bool Unavailable(Exception ex) => ex is IOException or DllNotFoundException or EntryPointNotFoundException or BadImageFormatException;
    public int Temperature(string id) { Check(GetTemperature(Device(id), 0, out var value)); if (value is 0 or > 125) throw new IOException("Invalid GPU temperature."); return (int)value; }
    public ClockRange Read(string id, int domain)
    {
        if (domain is not (0 or 2)) throw new ArgumentException("Invalid clock domain.");
        var value = new Offset { Version = (1u << 24) | 24u, Type = (uint)domain, Pstate = 0 };
        Check(GetOffset(Device(id), ref value));
        if (value.Minimum > value.Current || value.Current > value.Maximum) throw new IOException("Invalid driver clock bounds.");
        return new(value.Current, value.Minimum, value.Maximum);
    }
    public void Write(string id, int domain, int offset)
    {
        var range = Read(id, domain);
        if (offset < range.Minimum || offset > range.Maximum) throw new ArgumentException("Clock offset is outside driver bounds.");
        var value = new Offset { Version = (1u << 24) | 24u, Type = (uint)domain, Pstate = 0, Current = offset };
        Check(SetOffset(Device(id), ref value));
        if (Read(id, domain).Current != offset) throw new IOException("Driver did not confirm the requested clock offset.");
    }
    // Load only the driver-installed system DLL, never an application-directory DLL.
    [DllImport("nvml.dll", EntryPoint="nvmlDeviceGetClockInfo"), DefaultDllImportSearchPaths(DllImportSearchPath.System32)] private static extern int CurrentClock(IntPtr device, uint domain, out uint value);
    [DllImport("nvml.dll", EntryPoint="nvmlDeviceGetMaxClockInfo"), DefaultDllImportSearchPaths(DllImportSearchPath.System32)] private static extern int MaxClock(IntPtr device, uint domain, out uint value);
    [DllImport("nvml.dll", EntryPoint="nvmlDeviceGetPowerUsage"), DefaultDllImportSearchPaths(DllImportSearchPath.System32)] private static extern int Power(IntPtr device, out uint value);
    [DllImport("nvml.dll", EntryPoint="nvmlDeviceGetPowerManagementLimit"), DefaultDllImportSearchPaths(DllImportSearchPath.System32)] private static extern int PowerLimit(IntPtr device, out uint value);
    [DllImport("nvml.dll", EntryPoint="nvmlInit_v2"), DefaultDllImportSearchPaths(DllImportSearchPath.System32)] private static extern int Init();
    [DllImport("nvml.dll", EntryPoint="nvmlDeviceGetCount_v2"), DefaultDllImportSearchPaths(DllImportSearchPath.System32)] private static extern int Count(out uint count);
    [DllImport("nvml.dll", EntryPoint="nvmlDeviceGetHandleByIndex_v2"), DefaultDllImportSearchPaths(DllImportSearchPath.System32)] private static extern int At(uint index, out IntPtr device);
    [DllImport("nvml.dll", EntryPoint="nvmlDeviceGetHandleByUUID", CharSet=CharSet.Ansi), DefaultDllImportSearchPaths(DllImportSearchPath.System32)] private static extern int Handle(string id, out IntPtr device);
    [DllImport("nvml.dll", EntryPoint="nvmlDeviceGetName", CharSet=CharSet.Ansi), DefaultDllImportSearchPaths(DllImportSearchPath.System32)] private static extern int Name(IntPtr device, StringBuilder name, uint length);
    [DllImport("nvml.dll", EntryPoint="nvmlDeviceGetUUID", CharSet=CharSet.Ansi), DefaultDllImportSearchPaths(DllImportSearchPath.System32)] private static extern int Uuid(IntPtr device, StringBuilder id, uint length);
    [DllImport("nvml.dll", EntryPoint="nvmlDeviceGetTemperature"), DefaultDllImportSearchPaths(DllImportSearchPath.System32)] private static extern int GetTemperature(IntPtr device, uint sensor, out uint temperature);
    [DllImport("nvml.dll", EntryPoint="nvmlDeviceGetClockOffsets"), DefaultDllImportSearchPaths(DllImportSearchPath.System32)] private static extern int GetOffset(IntPtr device, ref Offset info);
    [DllImport("nvml.dll", EntryPoint="nvmlDeviceSetClockOffsets"), DefaultDllImportSearchPaths(DllImportSearchPath.System32)] private static extern int SetOffset(IntPtr device, ref Offset info);
}
