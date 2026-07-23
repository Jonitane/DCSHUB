using System.Diagnostics;
using DcsHub.Core;

namespace DcsHub.Windows;

public sealed class DcsProcessWatcher : IAsyncDisposable
{
    private readonly TimeSpan interval;
    private readonly CancellationTokenSource stopping = new();
    private Task? loopTask;
    private DcsProcessStatus current = new(false, null, DateTimeOffset.UtcNow);

    public DcsProcessWatcher(TimeSpan? interval = null)
    {
        this.interval = interval ?? TimeSpan.FromSeconds(2);
    }

    public event Action<DcsProcessStatus>? Changed;

    public DcsProcessStatus Current => current;

    public void Start()
    {
        if (loopTask is not null) return;
        loopTask = RunAsync(stopping.Token);
    }

    public DcsProcessStatus Refresh()
    {
        var next = Probe();
        Update(next);
        return next;
    }

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                Refresh();
                await Task.Delay(interval, cancellationToken).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
    }

    private static DcsProcessStatus Probe()
    {
        Process[] processes = [];
        try
        {
            processes = Process.GetProcessesByName("DCS");
            var process = processes.FirstOrDefault(candidate => !candidate.HasExited);
            return new(process is not null, process?.Id, DateTimeOffset.UtcNow);
        }
        catch (InvalidOperationException)
        {
            return new(false, null, DateTimeOffset.UtcNow);
        }
        finally
        {
            foreach (var process in processes) process.Dispose();
        }
    }

    private void Update(DcsProcessStatus next)
    {
        var changed = next.Running != current.Running || next.ProcessId != current.ProcessId;
        current = next;
        if (changed) Changed?.Invoke(next);
    }

    public async ValueTask DisposeAsync()
    {
        stopping.Cancel();
        if (loopTask is not null)
        {
            try { await loopTask.ConfigureAwait(false); }
            catch (OperationCanceledException) { }
        }
        stopping.Dispose();
    }
}
