using Meili.Core.Diagnostics;
using Meili.Data;

namespace Meili.Shared.Services;

/// <summary>Desktop probe scheduling only. Real provider outcomes remain owned by the router/HealthTracker.</summary>
public sealed class DataSourceHealthMonitor : IDisposable
{
    public static readonly TimeSpan RefreshInterval = TimeSpan.FromMinutes(5);
    private readonly IReadOnlyList<Func<CancellationToken, Task>> _probes;
    private readonly DesktopActivity _activity;
    private readonly TimeProvider _time;
    private readonly IUiTimer _timer = Ui.Timer(TimeSpan.FromSeconds(30));
    private CancellationTokenSource? _round;
    private Task _running = Task.CompletedTask;
    private bool _started, _disposed;
    private DateTimeOffset? _nextSweep;
    public bool IsTesting { get; private set; }
    public event EventHandler? Changed;

    public DataSourceHealthMonitor(DataServices data, DesktopActivity activity)
        : this(data.Providers.Select(p => (Func<CancellationToken, Task>)(async ct =>
        {
            using var budget = CancellationTokenSource.CreateLinkedTokenSource(ct);
            budget.CancelAfter(TimeSpan.FromSeconds(12));
            try { await data.Router.ProbeAsync(p, budget.Token).ConfigureAwait(false); }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested) { data.Health.RecordFailure(p.Id, "Health probe timed out after 12 seconds"); }
        })).ToArray(), activity, TimeProvider.System) { }

    internal DataSourceHealthMonitor(IReadOnlyList<Func<CancellationToken, Task>> probes, DesktopActivity activity, TimeProvider time)
    {
        _probes = probes; _activity = activity; _time = time;
        _timer.Tick += OnTick; activity.Changed += OnActivity;
    }

    public void Start() { if (_disposed) return; _started = true; Schedule(); }
    public void Invalidate() { _nextSweep = null; _round?.Cancel(); if (_started) Schedule(); }
    private void OnTick(object? sender, EventArgs e) => Schedule();
    private void OnActivity(object? sender, EventArgs e) => Ui.Platform.Run(Schedule);
    private void Schedule()
    {
        if (_disposed || !_started) return;
        if (!_activity.AnyVisible) { _timer.Stop(); if (IsTesting) { _nextSweep = null; _round?.Cancel(); } return; }
        if (!_timer.IsEnabled) _timer.Start();
        if (_nextSweep is null || _time.GetUtcNow() >= _nextSweep) _ = RefreshAsync();
    }

    /// <summary>Called on the UI thread. Manual and automatic requests share the same bounded round.</summary>
    public Task RefreshAsync()
    {
        if (_disposed) return Task.CompletedTask;
        if (IsTesting) return _running;
        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _running = completion.Task;
        IsTesting = true;
        _nextSweep = _time.GetUtcNow() + RefreshInterval;
        _round = new CancellationTokenSource(TimeSpan.FromSeconds(Math.Max(60, Math.Ceiling(_probes.Count / 2d) * 12 + 5)));
        Changed?.Invoke(this, EventArgs.Empty);
        _ = RunAsync(_round, completion);
        return _running;
    }

    private async Task RunAsync(CancellationTokenSource round, TaskCompletionSource completion)
    {
        try
        {
            await Parallel.ForEachAsync(_probes, new ParallelOptions { MaxDegreeOfParallelism = 2, CancellationToken = round.Token },
                async (probe, ct) => await probe(ct).ConfigureAwait(false));
            if (!round.IsCancellationRequested) _nextSweep = _time.GetUtcNow() + RefreshInterval;
        }
        catch (OperationCanceledException) when (round.IsCancellationRequested) { }
        catch (Exception ex) { AppLog.Warn("source-health", "Provider health sweep failed", ex); }
        finally
        {
            _round = null; round.Dispose(); IsTesting = false;
            if (!_disposed) Changed?.Invoke(this, EventArgs.Empty);
            completion.TrySetResult();
            if (!_disposed && _started && _activity.AnyVisible && _nextSweep is null) Schedule();
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true; _timer.Stop(); _timer.Tick -= OnTick; _activity.Changed -= OnActivity; _round?.Cancel();
    }
}
