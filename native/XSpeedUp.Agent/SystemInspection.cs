using System.Diagnostics;
using System.Runtime.InteropServices;

namespace XSpeedUp.Agent;

public static class SystemInspection
{
    public static object Read()
    {
        var memory = new Native.MemoryStatus { Length = (uint)Marshal.SizeOf<Native.MemoryStatus>() };
        if (!Native.GlobalMemoryStatusEx(ref memory)) throw new IOException("Не удалось получить информацию о памяти.");
        var drive = new DriveInfo(Path.GetPathRoot(Environment.SystemDirectory)!);
        return new
        {
            Machine = Environment.MachineName,
            Os = RuntimeInformation.OSDescription,
            IsAdmin = Services.IsAdmin,
            ProcessorCount = Environment.ProcessorCount,
            TotalMemory = memory.TotalPhysical,
            AvailableMemory = memory.AvailablePhysical,
            DriveTotal = drive.TotalSize,
            DriveFree = drive.AvailableFreeSpace,
            UptimeSeconds = Environment.TickCount64 / 1000,
            User = Environment.UserName
        };
    }
    private static bool CanClose(Process process)
    {
        using var current = Process.GetCurrentProcess();
        if (process.Id == Environment.ProcessId || process.SessionId != current.SessionId || process.MainWindowHandle == IntPtr.Zero) return false;
        var name = process.ProcessName;
        if (new[] { "electron", "X SpeedUp", "XSpeedUp.Agent", "explorer", "ApplicationFrameHost", "ShellExperienceHost", "StartMenuExperienceHost", "SearchHost", "Taskmgr", "SystemSettings", "sihost", "dwm", "winlogon", "csrss", "lsass", "services", "svchost", "SecurityHealthSystray" }.Contains(name, StringComparer.OrdinalIgnoreCase)) return false;
        var path = process.MainModule?.FileName;
        if (path is null || path.StartsWith(Environment.GetFolderPath(Environment.SpecialFolder.Windows) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return false;
        return true;
    }
    public static ProcessItem[] Processes()
    {
        var result = new List<ProcessItem>();
        foreach (var process in Process.GetProcesses())
        {
            using (process)
            {
                try
                {
                    if (CanClose(process)) result.Add(new(process.Id, process.ProcessName, process.WorkingSet64, process.MainWindowTitle, process.StartTime.ToUniversalTime().ToString("O")));
                }
                catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception or NotSupportedException) { }
            }
        }
        return result.OrderByDescending(p => p.Memory).ToArray();
    }
    public static ActionResult Close(int id, string startTime)
    {
        using var process = Process.GetProcessById(id);
        if (!CanClose(process) || process.StartTime.ToUniversalTime().ToString("O") != startTime)
            throw new InvalidOperationException("Процесс изменился или недоступен для закрытия. Обновите список.");
        bool sent = process.CloseMainWindow();
        return new(sent ? "Запрос на закрытие отправлен. Приложение может попросить сохранить документы; проверьте его окно." : "Приложение не приняло запрос на закрытие.", sent ? 1 : 0);
    }
}
