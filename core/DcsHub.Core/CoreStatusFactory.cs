namespace DcsHub.Core;

public static class CoreStatusFactory
{
    public static CoreStatus Create(DateTimeOffset startedAt) => new(
        CoreProtocol.Version,
        "dotnet-native",
        startedAt,
        [
            new("windows-process-monitor", "ready", 1),
            new("dcs-telemetry", "planned", 1),
            new("dcs-command", "planned", 1),
            new("speech-recognition", "ready", 1),
            new("elevated-broker", "planned", 1),
        ]);
}
