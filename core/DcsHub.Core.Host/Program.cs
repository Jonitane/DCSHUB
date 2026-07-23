using System.Diagnostics;
using System.IO.Pipes;
using System.Text.Json;
using DcsHub.Core;
using DcsHub.Core.Host;
using DcsHub.Windows;

var arguments = Arguments.Parse(args);
var logger = new CoreLogger(arguments.LogDirectory);
var startedAt = DateTimeOffset.UtcNow;
var jsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web);
using var lifetime = new CancellationTokenSource();
using var parentLifetime = new CancellationTokenSource();
await using var watcher = new DcsProcessWatcher();
using var speech = new SenseVoiceService();

logger.Write("info", "starting", new { protocol = CoreProtocol.Version, parentPid = arguments.ParentPid });

_ = WatchParentAsync(arguments.ParentPid, lifetime, parentLifetime.Token);

await using var pipe = new NamedPipeServerStream(
    arguments.PipeName,
    PipeDirection.InOut,
    1,
    PipeTransmissionMode.Byte,
    PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);

await pipe.WaitForConnectionAsync(lifetime.Token);
using var reader = new StreamReader(pipe, leaveOpen: true);
await using var writer = new StreamWriter(pipe, leaveOpen: true) { AutoFlush = true };
var writeGate = new SemaphoreSlim(1, 1);
var authenticated = false;

async Task SendAsync(object payload)
{
    var json = JsonSerializer.Serialize(payload, jsonOptions);
    await writeGate.WaitAsync(lifetime.Token);
    try { await writer.WriteLineAsync(json); }
    finally { writeGate.Release(); }
}

watcher.Changed += status =>
{
    if (!authenticated || lifetime.IsCancellationRequested) return;
    _ = SendAsync(new CoreEvent("event", "dcs-process-changed", status));
};
watcher.Start();

try
{
    while (!lifetime.IsCancellationRequested && pipe.IsConnected)
    {
        var line = await reader.ReadLineAsync(lifetime.Token);
        if (line is null) break;
        CoreRequest? request;
        try { request = JsonSerializer.Deserialize(line, CoreJsonContext.Default.CoreRequest); }
        catch (JsonException error)
        {
            logger.Write("warn", "invalid-json", new { error.Message });
            continue;
        }
        if (request is null || request.Kind != "request") continue;

        if (!authenticated)
        {
            if (request.Method != "system.handshake" || request.Token != arguments.Token)
            {
                await SendAsync(Failure(request.Id, "AUTH_FAILED", "Core handshake failed", false));
                break;
            }
            var handshake = request.Params?.Deserialize(CoreJsonContext.Default.HandshakeRequest);
            if (handshake is null || handshake.ProtocolVersion != CoreProtocol.Version || handshake.ParentPid != arguments.ParentPid)
            {
                await SendAsync(Failure(request.Id, "PROTOCOL_MISMATCH", "Core protocol or parent process does not match", false));
                break;
            }
            authenticated = true;
            await SendAsync(Success(request.Id, CoreStatusFactory.Create(startedAt)));
            logger.Write("info", "connected");
            continue;
        }

        switch (request.Method)
        {
            case "system.ping":
                await SendAsync(Success(request.Id, new { timestamp = DateTimeOffset.UtcNow }));
                break;
            case "system.status":
                await SendAsync(Success(request.Id, CoreStatusFactory.Create(startedAt)));
                break;
            case "dcs.process.status":
                await SendAsync(Success(request.Id, watcher.Refresh()));
                break;
            case "speech.devices":
                await SendAsync(Success(request.Id, speech.Devices()));
                break;
            case "speech.status":
                await SendAsync(Success(request.Id, speech.Status()));
                break;
            case "speech.start":
                try
                {
                    var speechStart = request.Params?.Deserialize(CoreJsonContext.Default.SpeechStartRequest) ?? new SpeechStartRequest(null);
                    speech.Start(speechStart.DeviceId);
                    await SendAsync(Success(request.Id, new { recording = true }));
                }
                catch (Exception error)
                {
                    await SendAsync(Failure(request.Id, "SPEECH_START_FAILED", error.Message, true));
                }
                break;
            case "speech.stop":
                try
                {
                    var speechStop = request.Params?.Deserialize(CoreJsonContext.Default.SpeechStopRequest)
                        ?? throw new ArgumentException("SenseVoice model directory is required");
                    var result = await Task.Run(() => speech.Stop(speechStop.ModelDirectory), lifetime.Token);
                    await SendAsync(Success(request.Id, result));
                }
                catch (Exception error)
                {
                    speech.Cancel();
                    await SendAsync(Failure(request.Id, "SPEECH_RECOGNITION_FAILED", error.Message, true));
                }
                break;
            case "speech.cancel":
                speech.Cancel();
                await SendAsync(Success(request.Id, new { recording = false }));
                break;
            case "system.shutdown":
                await SendAsync(Success(request.Id, new { shuttingDown = true }));
                lifetime.Cancel();
                break;
            default:
                await SendAsync(Failure(request.Id, "METHOD_NOT_FOUND", $"Unknown method: {request.Method}", true));
                break;
        }
    }
}
catch (OperationCanceledException) when (lifetime.IsCancellationRequested)
{
}
catch (IOException error)
{
    logger.Write("warn", "pipe-disconnected", new { error.Message });
}
finally
{
    logger.Write("info", "stopped");
    writeGate.Dispose();
    parentLifetime.Cancel();
}

static CoreResponse Success(string id, object? result) => new("response", id, true, result, null);

static CoreResponse Failure(string id, string code, string message, bool recoverable) =>
    new("response", id, false, null, new(code, message, recoverable));

static async Task WatchParentAsync(int parentPid, CancellationTokenSource lifetime, CancellationToken cancellationToken)
{
    try
    {
        using var parent = Process.GetProcessById(parentPid);
        await parent.WaitForExitAsync(cancellationToken);
        lifetime.Cancel();
    }
    catch (ArgumentException)
    {
        lifetime.Cancel();
    }
    catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
    {
    }
}

internal sealed record Arguments(string PipeName, string Token, int ParentPid, string LogDirectory)
{
    public static Arguments Parse(string[] args)
    {
        string Value(string name)
        {
            var index = Array.IndexOf(args, name);
            if (index < 0 || index + 1 >= args.Length || string.IsNullOrWhiteSpace(args[index + 1]))
                throw new ArgumentException($"Missing required argument: {name}");
            return args[index + 1];
        }

        var parent = int.Parse(Value("--parent-pid"), System.Globalization.CultureInfo.InvariantCulture);
        return new(Value("--pipe"), Value("--token"), parent, Value("--log-dir"));
    }
}
