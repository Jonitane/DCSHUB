using System.Text.Json;
using DcsHub.Core;

static void Assert(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

var status = CoreStatusFactory.Create(DateTimeOffset.UtcNow);
Assert(status.ProtocolVersion == CoreProtocol.Version, "Protocol versions must match");
Assert(status.Runtime == "dotnet-native", "Core runtime must be native .NET");
Assert(status.Services.Any(service => service.Id == "windows-process-monitor" && service.State == "ready"), "Windows monitor must be ready");
Assert(status.Services.Any(service => service.Id == "speech-recognition" && service.State == "ready"), "Speech capability must be ready");
Assert(status.Services.Select(service => service.Id).Distinct(StringComparer.Ordinal).Count() == status.Services.Count, "Service ids must be unique");

var request = new CoreRequest("request", "1", "system.handshake", "secret", JsonSerializer.SerializeToElement(new HandshakeRequest(CoreProtocol.Version, 42), CoreJsonContext.Default.HandshakeRequest));
var json = JsonSerializer.Serialize(request, CoreJsonContext.Default.CoreRequest);
var parsed = JsonSerializer.Deserialize(json, CoreJsonContext.Default.CoreRequest);
Assert(parsed?.Method == "system.handshake", "Protocol request must round-trip");
Assert(parsed?.Params?.Deserialize(CoreJsonContext.Default.HandshakeRequest)?.ParentPid == 42, "Handshake payload must round-trip");

Console.WriteLine("native core contract tests passed");
