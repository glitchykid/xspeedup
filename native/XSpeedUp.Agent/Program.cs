using System.Text;
using System.Text.Json;

namespace XSpeedUp.Agent;

public static class Program
{
    public static async Task Main(string[] startupArgs)
    {
        if (startupArgs is ["--tuning-watchdog", var recoveryId]) { AutoTuner.Watchdog(recoveryId); return; }
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        var journal = Journal.Create();
        var cleanup = Cleanup.Create(journal);
        var registry = new RegistryMaintenance(journal);
        using var folders = EmptyFolders.Create(journal);
        var memory = new MemoryCleaner(journal);
        var services = new Services(journal);
        var gaming = new GameMode(journal);
        var tuning = new AutoTuner(journal);
        while (await Console.In.ReadLineAsync() is { } line)
        {
            string? id = null;
            try
            {
                if (line.Length > 8 * 1024 * 1024) throw new ArgumentException("Слишком большой запрос.");
                using var document = JsonDocument.Parse(line);
                var request = document.RootElement;
                id = request.GetProperty("id").GetString();
                var method = request.GetProperty("method").GetString();
                var args = request.GetProperty("args");
                string Text(string key) => args.GetProperty(key).GetString() ?? throw new ArgumentException(key);
                string[] Strings(string key) => args.GetProperty(key).EnumerateArray().Select(x => x.GetString() ?? "").ToArray();
                object Restore()
                {
                    var entry = journal.Read(Text("id"));
                    if (entry.Restored) throw new InvalidOperationException("Копия уже восстановлена.");
                    return entry.Kind switch
                    {
                        "registry" => new RegistryCleaner(journal).Restore(entry),
                        "registry-v2" => registry.Restore(entry),
                        "services" => services.Restore(entry),
                        "gaming" => gaming.Restore(entry),
                        "tuning" => tuning.Restore(entry),
                        _ => throw new InvalidOperationException("Для удаления файлов восстановление недоступно.")
                    };
                }
                object data = method switch
                {
                    "system" => SystemInspection.Read(),
                    "tuning.status" => tuning.Status(),
                    "tuning.start" => tuning.Start(Text("deviceId"), args.GetProperty("stepSeconds").GetInt32()),
                    "tuning.heartbeat" => tuning.Heartbeat(Text("id")),
                    "tuning.advance" => tuning.Advance(Text("id")),
                    "tuning.finish" => tuning.Finish(Text("id"), args.GetProperty("completed").GetBoolean()),
                    "gaming.status" => gaming.Status(),
                    "gaming.start" => gaming.Start(Strings("serviceIds"), args.GetProperty("processes").Deserialize<GameProcess[]>(Json.Options) ?? []),
                    "gaming.stop" => gaming.Stop(),
                    "cleanup.scan" => cleanup.Scan(),
                    "cleanup.apply" => cleanup.Apply(Text("scanId"), Strings("categoryIds")),
                    "registry.scan" => registry.Scan(),
                    "registry.apply" => args.GetProperty("entryIds").ValueKind == JsonValueKind.String && Text("entryIds") == "all"
                        ? registry.ApplyAll(Text("scanId")) : registry.Apply(Text("scanId"), Strings("entryIds")),
                    "folders.scan" => folders.Scan(args.TryGetProperty("root", out var root) ? root.GetString() : null),
                    "folders.continue" => folders.Continue(Text("scanId")),
                    "folders.cancel" => folders.Cancel(Text("scanId")),
                    "folders.apply" => args.GetProperty("entryIds").ValueKind == JsonValueKind.String && Text("entryIds") == "all"
                        ? folders.ApplyAll(Text("scanId")) : folders.Apply(Text("scanId"), Strings("entryIds")),
                    "memory.release" => memory.Release(args.GetProperty("processId").GetInt32(), Text("startTime")),
                    "services.list" => services.List(),
                    "services.disable" => services.Disable(Strings("serviceIds")),
                    "processes.list" => SystemInspection.Processes(),
                    "processes.close" => SystemInspection.Close(args.GetProperty("processId").GetInt32(), Text("startTime")),
                    "history.list" => journal.List(),
                    "history.restore" => Restore(),
                    _ => throw new ArgumentException("Неизвестная операция.")
                };
                await Console.Out.WriteLineAsync(Json.Serialize(new { id, ok = true, data }));
            }
            catch (Exception ex)
            {
                await Console.Out.WriteLineAsync(Json.Serialize(new { id, ok = false, error = ex.Message }));
            }
        }
    }
}
