using Meili.Data;

namespace Meili.Shared.Tests;

[Collection(nameof(UiPlatformCollection))]
public sealed class DataSourceHealthMonitorTests
{
    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => Now;
    }

    [Fact]
    public async Task Startup_tests_every_source_even_when_quotes_already_tested_one_and_timer_refreshes_after_five_minutes()
    {
        var ui = new FakeUiPlatform(); Ui.Platform = ui;
        using var data = new DataServices(new());
        var health = data.Health; health.RecordSuccess(data.Providers[0].Id, TimeSpan.Zero);
        var activity = new DesktopActivity(); activity.SetVisible("main", true); var clock = new Clock(); var calls = 0; var count = data.Providers.Count;
        using var monitor = new DataSourceHealthMonitor(data.Providers.Select(p => (Func<CancellationToken, Task>)(_ =>
        { Interlocked.Increment(ref calls); health.RecordSuccess(p.Id, TimeSpan.Zero); return Task.CompletedTask; })).ToArray(), activity, clock);
        monitor.Start(); await Until(() => !monitor.IsTesting);
        Assert.Equal(count, calls); Assert.All(health.All, h => Assert.Equal(Meili.Data.Routing.HealthState.Healthy, h.State(health.Now)));
        var timer = Assert.Single(ui.Timers); clock.Now += TimeSpan.FromMinutes(4); timer.Fire(); Assert.Equal(count, calls);
        clock.Now += TimeSpan.FromMinutes(1); timer.Fire(); await Until(() => !monitor.IsTesting); Assert.Equal(count * 2, calls);
        activity.SetVisible("main", false); Assert.False(timer.IsEnabled);
        activity.SetVisible("main", true); Assert.Equal(count * 2, calls); // Fresh results survive a quick hide/restore.
        activity.SetVisible("main", false); clock.Now += TimeSpan.FromMinutes(6); timer.Fire(); Assert.Equal(count * 2, calls);
        activity.SetVisible("main", true); await Until(() => !monitor.IsTesting); Assert.Equal(count * 3, calls);
    }

    [Fact]
    public async Task Automatic_and_manual_sweeps_share_work_bound_concurrency_and_cancel_on_hide()
    {
        Ui.Platform = new FakeUiPlatform(); var activity = new DesktopActivity(); activity.SetVisible("main", true);
        var entered = 0; var inFlight = 0; var max = 0;
        async Task Probe(CancellationToken ct)
        {
            var n = Interlocked.Increment(ref inFlight);int observed;do{observed=Volatile.Read(ref max);if(observed>=n)break;}while(Interlocked.CompareExchange(ref max,n,observed)!=observed);Interlocked.Increment(ref entered);
            try { await Task.Delay(Timeout.InfiniteTimeSpan, ct); } finally { Interlocked.Decrement(ref inFlight); }
        }
        using var monitor = new DataSourceHealthMonitor(Enumerable.Repeat<Func<CancellationToken, Task>>(Probe, 8).ToArray(), activity, new Clock());
        monitor.Start(); var first = monitor.RefreshAsync(); Assert.Same(first, monitor.RefreshAsync());
        await Until(() => Volatile.Read(ref entered) == 2); Assert.Equal(2, Volatile.Read(ref max));
        activity.SetVisible("main", false); await first; Assert.False(monitor.IsTesting); Assert.Equal(0, inFlight); Assert.Equal(2, entered);
        activity.SetVisible("main", true); await Until(() => Volatile.Read(ref entered) == 4);
        var resumed = monitor.RefreshAsync(); monitor.Dispose(); await resumed; Assert.Equal(0, inFlight);
        activity.SetVisible("main", false); activity.SetVisible("main", true); Assert.Equal(4, entered);
    }

    [Fact]
    public async Task Network_reconfiguration_cancels_old_round_and_retests_without_hot_retrying_failures()
    {
        var ui = new FakeUiPlatform(); Ui.Platform = ui; var activity = new DesktopActivity(); activity.SetVisible("main", true);
        var calls = 0;
        async Task Probe(CancellationToken ct)
        {
            if (Interlocked.Increment(ref calls) <= 2) await Task.Delay(Timeout.InfiniteTimeSpan, ct);
        }
        using var monitor = new DataSourceHealthMonitor([Probe, Probe], activity, new Clock()); monitor.Start();
        await Until(() => calls == 2); monitor.Invalidate(); await Until(() => calls == 4 && !monitor.IsTesting);
        Assert.Equal(4, calls); ui.Timers.Single().Fire(); Assert.Equal(4, calls);
        var failures = 0;
        using var failed = new DataSourceHealthMonitor([_ => { Interlocked.Increment(ref failures); throw new IOException("fixture failure"); }], activity, new Clock());
        failed.Start(); await Until(() => !failed.IsTesting); ui.Timers.Last().Fire(); Assert.Equal(1, failures);
    }

    private static async Task Until(Func<bool> predicate)
    {
        using var budget = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        while (!predicate()) await Task.Delay(10, budget.Token);
    }
}
