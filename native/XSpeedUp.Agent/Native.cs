using Microsoft.Win32.SafeHandles;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace XSpeedUp.Agent;

internal static class Native
{
    [DllImport("psapi.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool EmptyWorkingSet(SafeProcessHandle process);

    public static FolderCandidate InspectDirectory(string path)
    {
        using var directory = CreateFile(path, 0x80, 7, IntPtr.Zero, 3, 0x02000000 | 0x00200000, IntPtr.Zero);
        if (directory.IsInvalid || !GetFileInformationByHandle(directory, out var info)) throw new Win32Exception(Marshal.GetLastWin32Error());
        if ((info.Attributes & (uint)FileAttributes.Directory) == 0 || (info.Attributes & (uint)FileAttributes.ReparsePoint) != 0)
            throw new IOException("Not a regular directory.");
        long created = ((long)info.Created.dwHighDateTime << 32) | (uint)info.Created.dwLowDateTime;
        return new(Guid.NewGuid().ToString("N"), path, DateTime.FromFileTimeUtc(created), ((ulong)info.IndexHigh << 32) | info.IndexLow, info.Volume);
    }
    public static void DeleteEmptyDirectory(FolderCandidate candidate)
    {
        using var directory = CreateFile(candidate.Path, 0x10000 | 0x80, 0x1 | 0x2, IntPtr.Zero, 3,
            0x02000000 | 0x00200000, IntPtr.Zero);
        if (directory.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        var final = new StringBuilder(32768);
        uint length = GetFinalPathNameByHandle(directory, final, (uint)final.Capacity, 0);
        if (length == 0 || length >= final.Capacity) throw new IOException("Cannot resolve directory handle.");
        var actual = final.ToString();
        if (actual.StartsWith(@"\\?\", StringComparison.Ordinal)) actual = actual[4..];
        if (!actual.Equals(Path.GetFullPath(candidate.Path), StringComparison.OrdinalIgnoreCase))
            throw new IOException("Directory target changed or is redirected.");
        if (!GetFileInformationByHandle(directory, out var info)) throw new Win32Exception(Marshal.GetLastWin32Error());
        long created = ((long)info.Created.dwHighDateTime << 32) | (uint)info.Created.dwLowDateTime;
        if ((info.Attributes & (uint)FileAttributes.Directory) == 0 ||
            (info.Attributes & (uint)(FileAttributes.ReparsePoint | FileAttributes.System)) != 0 ||
            DateTime.FromFileTimeUtc(created) != candidate.CreatedUtc || candidate.Volume != info.Volume ||
            candidate.Identity != (((ulong)info.IndexHigh << 32) | info.IndexLow))
            throw new IOException("Directory changed since the scan.");
        // The kernel refuses disposition for nonempty directories; never recurse or delete children.
        byte delete = 1;
        if (!SetFileInformationByHandle(directory, 4, ref delete, 1)) throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    [StructLayout(LayoutKind.Sequential)]
    internal struct MemoryStatus
    {
        public uint Length, Load;
        public ulong TotalPhysical, AvailablePhysical, TotalPageFile, AvailablePageFile, TotalVirtual, AvailableVirtual, Extended;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GlobalMemoryStatusEx(ref MemoryStatus status);

    [StructLayout(LayoutKind.Sequential)]
    private struct FileInformation
    {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Created, Accessed, Modified;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(SafeFileHandle file, StringBuilder path, uint length, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInformation info);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetFileInformationByHandle(SafeFileHandle file, int infoClass, ref byte info, uint length);

    public static void DeleteVerified(FileCandidate candidate)
    {
        // Delete through the verified handle, never by a path that can be replaced after validation.
        using var file = CreateFile(candidate.Path, 0x10000 | 0x80, 0x1, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero);
        if (file.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        var final = new StringBuilder(32768);
        uint length = GetFinalPathNameByHandle(file, final, (uint)final.Capacity, 0);
        if (length == 0 || length >= final.Capacity) throw new IOException("Cannot resolve file handle.");
        var actual = final.ToString();
        if (actual.StartsWith(@"\\?\", StringComparison.Ordinal)) actual = actual[4..];
        if (!actual.Equals(Path.GetFullPath(candidate.Path), StringComparison.OrdinalIgnoreCase))
            throw new IOException("File target changed or uses a redirected path.");
        if (!GetFileInformationByHandle(file, out var info)) throw new Win32Exception(Marshal.GetLastWin32Error());
        long size = ((long)info.SizeHigh << 32) | info.SizeLow;
        long modified = ((long)info.Modified.dwHighDateTime << 32) | (uint)info.Modified.dwLowDateTime;
        if ((info.Attributes & (uint)(FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0 ||
            size != candidate.Bytes || DateTime.FromFileTimeUtc(modified) != candidate.ModifiedUtc)
            throw new IOException("File changed since the scan.");
        byte delete = 1;
        if (!SetFileInformationByHandle(file, 4, ref delete, 1)) throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern IntPtr OpenSCManager(string? machine, string? database, uint access);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern IntPtr OpenService(IntPtr manager, string name, uint access);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CloseServiceHandle(IntPtr handle);
    [StructLayout(LayoutKind.Sequential)]
    internal struct ServiceStatus { public uint Type, State, Controls, Win32Exit, ServiceExit, Checkpoint, WaitHint; }
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool QueryServiceStatus(IntPtr service, out ServiceStatus status);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool ControlService(IntPtr service, uint control, out ServiceStatus status);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool StartService(IntPtr service, uint count, IntPtr arguments);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool ChangeServiceConfig(IntPtr service, uint type, uint start, uint error,
        string? binary, string? group, IntPtr tag, string? dependencies, string? account, string? password, string? display);
}
