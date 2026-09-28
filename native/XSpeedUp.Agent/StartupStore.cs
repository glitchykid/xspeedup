using Microsoft.Win32;

namespace XSpeedUp.Agent;

public record StartupValue(string Name, string Value, RegistryValueKind Kind);
public interface IStartupStore
{
    IEnumerable<StartupValue> List();
    StartupValue? Get(string name);
    void Delete(string name);
    void Set(StartupValue value);
}

public sealed class WindowsStartupStore : IStartupStore
{
    public IEnumerable<StartupValue> List()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RegistryCleaner.RunKey);
        if (key is null) yield break;
        foreach (var name in key.GetValueNames())
        {
            var value = Read(key, name);
            if (value is not null) yield return value;
        }
    }
    private static StartupValue? Read(RegistryKey key, string name)
    {
        var value = key.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames);
        if (value is null) return null;
        var kind = key.GetValueKind(name);
        // Non-string values are represented too, so restore treats them as conflicts.
        return new(name, value is string s ? s : "", kind);
    }
    public StartupValue? Get(string name)
    {
        using var key = Registry.CurrentUser.OpenSubKey(RegistryCleaner.RunKey);
        return key is null ? null : Read(key, name);
    }
    public void Delete(string name)
    {
        using var key = Registry.CurrentUser.OpenSubKey(RegistryCleaner.RunKey, true) ?? throw new IOException("Раздел автозапуска недоступен.");
        key.DeleteValue(name, true);
    }
    public void Set(StartupValue value)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RegistryCleaner.RunKey, true);
        key.SetValue(value.Name, value.Value, value.Kind);
    }
}
