using System.Text;
using System.Text.Json;

namespace XSpeedUp.Agent;

public static class Program
{
    public static async Task Main()
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        var journal = Journal.Create();
        var cleanup = Cleanup.Create(journal);
        var registry = new RegistryCleaner(journal);
        var services = new Services(journal);
        while (await Console.In.ReadLineAsync() is { } line)
        {
            string? id = null;
            try
            {
                if (line.Length > 65536) throw new ArgumentException("Слишком большой запрос.");
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
                        "registry" => registry.Restore(entry),
                        "services" => services.Restore(entry),
                        _ => throw new InvalidOperationException("Для удаления файлов восстановление недоступно.")
                    };
                }
                object data = method switch
                {
                    "system" => SystemInspection.Read(),
                    "cleanup.scan" => cleanup.Scan(),
                    "cleanup.apply" => cleanup.Apply(Text("scanId"), Strings("categoryIds")),
                    "registry.scan" => registry.Scan(),
                    "registry.apply" => registry.Apply(Text("scanId"), Strings("entryIds")),
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
