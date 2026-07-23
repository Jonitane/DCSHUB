using System.Text.Json;

namespace DcsHub.Core.Host;

internal sealed class CoreLogger
{
    private readonly string filePath;
    private readonly object gate = new();

    public CoreLogger(string directory)
    {
        Directory.CreateDirectory(directory);
        filePath = Path.Combine(directory, "dcshub-core.log");
    }

    public void Write(string level, string eventName, object? detail = null)
    {
        var line = JsonSerializer.Serialize(new
        {
            time = DateTimeOffset.UtcNow,
            level,
            scope = "dotnet-core",
            @event = eventName,
            detail,
        });
        lock (gate) File.AppendAllText(filePath, line + Environment.NewLine);
    }
}
