using System.Text.Json;
using System.Text.Json.Serialization;

namespace DcsHub.Core;

public static class CoreProtocol
{
    public const int Version = 1;
}

public sealed record CoreRequest(
    string Kind,
    string Id,
    string Method,
    string? Token,
    JsonElement? Params);

public sealed record CoreResponse(
    string Kind,
    string Id,
    bool Ok,
    object? Result,
    CoreError? Error);

public sealed record CoreEvent(
    string Kind,
    string Event,
    object? Payload);

public sealed record CoreError(string Code, string Message, bool Recoverable);

public sealed record HandshakeRequest(int ProtocolVersion, int ParentPid);

public sealed record CoreServiceStatus(string Id, string State, int Version, string? Detail = null);

public sealed record CoreStatus(
    int ProtocolVersion,
    string Runtime,
    DateTimeOffset StartedAt,
    IReadOnlyList<CoreServiceStatus> Services);

public sealed record DcsProcessStatus(bool Running, int? ProcessId, DateTimeOffset CheckedAt);
public sealed record SpeechStartRequest(string? DeviceId);
public sealed record SpeechStopRequest(string ModelDirectory);

[JsonSerializable(typeof(CoreRequest))]
[JsonSerializable(typeof(CoreResponse))]
[JsonSerializable(typeof(CoreEvent))]
[JsonSerializable(typeof(CoreError))]
[JsonSerializable(typeof(HandshakeRequest))]
[JsonSerializable(typeof(CoreStatus))]
[JsonSerializable(typeof(CoreServiceStatus))]
[JsonSerializable(typeof(DcsProcessStatus))]
[JsonSerializable(typeof(SpeechStartRequest))]
[JsonSerializable(typeof(SpeechStopRequest))]
[JsonSerializable(typeof(JsonElement))]
[JsonSerializable(typeof(Dictionary<string, object?>))]
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
public partial class CoreJsonContext : JsonSerializerContext;
