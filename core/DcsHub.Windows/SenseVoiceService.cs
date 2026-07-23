using System.Diagnostics;
using NAudio.Wave;
using SherpaOnnx;

namespace DcsHub.Windows;

public sealed record SpeechInputDevice(string Id, string Name, bool IsDefault);
public sealed record SpeechCaptureResult(string Text, int AudioDurationMs, int RecognitionMs);

public sealed class SenseVoiceService : IDisposable
{
    private readonly object gate = new();
    private WaveInEvent? capture;
    private List<float>? samples;
    private OfflineRecognizer? recognizer;
    private string? loadedModelDirectory;
    private readonly Stopwatch captureClock = new();

    public IReadOnlyList<SpeechInputDevice> Devices()
    {
        var result = new List<SpeechInputDevice>();
        for (var index = 0; index < WaveIn.DeviceCount; index++)
        {
            var capabilities = WaveIn.GetCapabilities(index);
            result.Add(new SpeechInputDevice($"wavein:{index}", capabilities.ProductName, index == 0));
        }
        return result;
    }

    public object Status() => new { recording = capture is not null, modelDirectory = loadedModelDirectory };

    public void Start(string? deviceId)
    {
        lock (gate)
        {
            if (capture is not null) throw new InvalidOperationException("Speech capture is already running");
            var deviceNumber = ParseDeviceNumber(deviceId);
            samples = new List<float>(16000 * 20);
            capture = new WaveInEvent
            {
                DeviceNumber = deviceNumber,
                WaveFormat = new WaveFormat(16000, 16, 1),
                BufferMilliseconds = 40,
                NumberOfBuffers = 3,
            };
            capture.DataAvailable += OnDataAvailable;
            captureClock.Restart();
            capture.StartRecording();
        }
    }

    public SpeechCaptureResult Stop(string modelDirectory)
    {
        float[] audio;
        int durationMs;
        lock (gate)
        {
            if (capture is null || samples is null) throw new InvalidOperationException("Speech capture is not running");
            capture.StopRecording();
            capture.DataAvailable -= OnDataAvailable;
            capture.Dispose();
            capture = null;
            captureClock.Stop();
            durationMs = (int)captureClock.ElapsedMilliseconds;
            audio = samples.ToArray();
            samples = null;
        }
        if (audio.Length < 1600) return new SpeechCaptureResult(string.Empty, durationMs, 0);
        EnsureRecognizer(modelDirectory);
        var clock = Stopwatch.StartNew();
        using var stream = recognizer!.CreateStream();
        stream.AcceptWaveform(16000, audio);
        recognizer.Decode(stream);
        clock.Stop();
        return new SpeechCaptureResult(DcsSpeechNormalizer.Normalize(stream.Result.Text), durationMs, (int)clock.ElapsedMilliseconds);
    }

    public void Cancel()
    {
        lock (gate)
        {
            if (capture is null) return;
            capture.StopRecording();
            capture.DataAvailable -= OnDataAvailable;
            capture.Dispose();
            capture = null;
            samples = null;
            captureClock.Reset();
        }
    }

    private void EnsureRecognizer(string directory)
    {
        var resolved = Path.GetFullPath(directory);
        var model = Path.Combine(resolved, "model.int8.onnx");
        var tokens = Path.Combine(resolved, "tokens.txt");
        if (!File.Exists(model) || !File.Exists(tokens)) throw new FileNotFoundException("SenseVoice model is incomplete. model.int8.onnx and tokens.txt are required.");
        if (recognizer is not null && string.Equals(loadedModelDirectory, resolved, StringComparison.OrdinalIgnoreCase)) return;
        recognizer?.Dispose();
        var config = new OfflineRecognizerConfig();
        config.FeatConfig.SampleRate = 16000;
        config.FeatConfig.FeatureDim = 80;
        config.ModelConfig.Tokens = tokens;
        config.ModelConfig.NumThreads = Math.Clamp(Environment.ProcessorCount / 2, 1, 4);
        config.ModelConfig.Provider = "cpu";
        config.ModelConfig.Debug = 0;
        config.ModelConfig.SenseVoice.Model = model;
        config.ModelConfig.SenseVoice.Language = "auto";
        config.ModelConfig.SenseVoice.UseInverseTextNormalization = 1;
        config.DecodingMethod = "greedy_search";
        recognizer = new OfflineRecognizer(config);
        loadedModelDirectory = resolved;
    }

    private void OnDataAvailable(object? sender, WaveInEventArgs eventArgs)
    {
        lock (gate)
        {
            if (samples is null) return;
            var count = eventArgs.BytesRecorded / 2;
            var maximum = 16000 * 90;
            for (var index = 0; index < count && samples.Count < maximum; index++)
            {
                var value = BitConverter.ToInt16(eventArgs.Buffer, index * 2);
                samples.Add(value / 32768f);
            }
        }
    }

    private static int ParseDeviceNumber(string? deviceId)
    {
        if (string.IsNullOrWhiteSpace(deviceId)) return 0;
        var parts = deviceId.Split(':', 2);
        if (parts.Length != 2 || parts[0] != "wavein" || !int.TryParse(parts[1], out var value) || value < 0 || value >= WaveIn.DeviceCount)
            throw new ArgumentException("The selected microphone is unavailable");
        return value;
    }

    public void Dispose()
    {
        Cancel();
        recognizer?.Dispose();
        recognizer = null;
    }
}

internal static class DcsSpeechNormalizer
{
    private static readonly (string Pattern, string Replacement)[] Terms =
    [
        ("f 14", "F-14"), ("f14", "F-14"), ("f 15", "F-15"), ("f15", "F-15"),
        ("f 16", "F-16"), ("f16", "F-16"), ("f 18", "F/A-18"), ("f18", "F/A-18"),
        ("a 10", "A-10"), ("a10", "A-10"), ("a h 64", "AH-64"), ("ah64", "AH-64"),
        ("c 130", "C-130"), ("c130", "C-130"), ("j f 17", "JF-17"), ("jf17", "JF-17"),
        ("s u 27", "Su-27"), ("m i g 29", "MiG-29"),
        ("j h m c s", "JHMCS"), ("h m c s", "HMCS"), ("h u d", "HUD"),
        ("u f c", "UFC"), ("i c p", "ICP"), ("d e d", "DED"),
        ("m f d", "MFD"), ("m f c d", "MFCD"), ("h s d", "HSD"), ("h s i", "HSI"),
        ("t d c", "TDC"), ("t m s", "TMS"), ("d m s", "DMS"), ("s o i", "SOI"),
        ("s p i", "SPI"), ("t g p", "TGP"), ("f l i r", "FLIR"), ("t a c a n", "TACAN"),
        ("i l s", "ILS"), ("i n s", "INS"), ("i f f", "IFF"), ("r w r", "RWR"),
        ("j t a c", "JTAC"), ("a w a c s", "AWACS"), ("d l s s", "DLSS"),
        ("a i m 7", "AIM-7"), ("a i m 9", "AIM-9"), ("a i m 54", "AIM-54"), ("a i m 120", "AIM-120"),
        ("a g m 65", "AGM-65"), ("a g m 88", "AGM-88"), ("a g m 114", "AGM-114"),
        ("g b u 12", "GBU-12"), ("g b u 24", "GBU-24"), ("g b u 31", "GBU-31"), ("g b u 38", "GBU-38"),
        ("g b u", "GBU"), ("j d a m", "JDAM"), ("j s o w", "JSOW"), ("h a r m", "HARM"),
        ("塔康", "TACAN"), ("杰达姆", "JDAM"), ("哈姆导弹", "HARM"), ("阿姆拉姆", "AMRAAM"),
        ("乔治 ai", "George AI"), ("乔治人工智能", "George AI"), ("杰斯特", "Jester"),
        ("彼得罗维奇", "Petrovich"), ("小牛导弹", "Maverick")
    ];

    public static string Normalize(string value)
    {
        var result = System.Text.RegularExpressions.Regex.Replace(value, @"<\|[^|>]+\|>", string.Empty).Trim();
        foreach (var (pattern, replacement) in Terms)
            result = System.Text.RegularExpressions.Regex.Replace(result, System.Text.RegularExpressions.Regex.Escape(pattern), replacement, System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        return System.Text.RegularExpressions.Regex.Replace(result, @"\s+([，。！？,.!?])", "$1").Trim();
    }
}
