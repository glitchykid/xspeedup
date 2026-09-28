using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace XSpeedUp.Agent;

public interface IMemoryTarget : IDisposable
{
    bool Eligible { get; }
    string StartTime { get; }
    string Name { get; }
    long WorkingSet { get; }
    void Trim();
}

internal sealed class WindowsMemoryTarget(int id) : IMemoryTarget
{
    private readonly Process process = Process.GetProcessById(id);
    public bool Eligible => SystemInspection.CanClose(process);
    public string StartTime => process.StartTime.ToUniversalTime().ToString("O");
    public string Name => process.ProcessName;
    public long WorkingSet { get { process.Refresh(); return process.WorkingSet64; } }
    public void Trim()
    {
        if (!Native.EmptyWorkingSet(process.SafeHandle)) throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    public void Dispose() => process.Dispose();
}

public sealed class MemoryCleaner(Journal journal, Func<int, IMemoryTarget>? open = null)
{
    private readonly Func<int, IMemoryTarget> target = open ?? (id => new WindowsMemoryTarget(id));
    public ActionResult Release(int id, string startTime)
    {
        if (id <= 0) throw new ArgumentException("Некорректный процесс.");
        using var process = target(id);
        if (!process.Eligible || process.StartTime != startTime)
            throw new InvalidOperationException("Процесс изменился или недоступен. Обновите список.");
        var entry = new JournalEntry { Kind = "memory", Summary = $"Запрошено освобождение ОЗУ: {process.Name}." };
        journal.Save(entry);
        long before = process.WorkingSet;
        process.Trim();
        long after = process.WorkingSet;
        long released = Math.Max(0, before - after);
        entry.Summary = $"ОЗУ: рабочий набор {process.Name} уменьшился на {released / 1048576d:F1} МБ.";
        entry.Details = [$"До: {before:N0} байт; после: {after:N0} байт.",
            "Это изменение рабочего набора, а не гарантированный прирост свободной памяти. Приложение может снова загрузить страницы; ускорение не гарантируется."];
        journal.Save(entry);
        return new(entry.Summary, 1, Bytes: released, Details: entry.Details);
    }
}
