using Meili.Core.Abstractions;
using Meili.Core.Models;
using Meili.Core.Quotes;

namespace Meili.Core.Tests;

/// <summary>C1: one fetch for all subscribers, short TTL, single-flight, health counters.</summary>
public class QuoteHubTests
{
    private sealed class Counting : IMarketDataService
    {
        public List<IReadOnlyList<string>> Calls { get; } = [];
        public Exception? Fail { get; set; }
        public TaskCompletionSource? Gate { get; set; }
        /// <summary>When set, waiting on <see cref="Gate"/> ends with the token like a real HTTP call would.</summary>
        public bool HonorToken { get; set; }

        public async Task<IReadOnlyList<Quote>> GetQuotesAsync(IReadOnlyList<string> symbols, CancellationToken ct = default)
        {
            Calls.Add(symbols.ToList());
            if (Gate is { } g) await (HonorToken ? g.Task.WaitAsync(ct) : g.Task);
            if (Fail is { } f) throw f;
            return symbols.Select(s => new Quote { Symbol = s, Price = 100, Source = "x" }).ToList();
        }
        public Task<BarSeries> GetBarsAsync(BarRequest request, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<DateOnly>> GetExpirationsAsync(string symbol, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<OptionChain> GetChainAsync(string symbol, DateOnly? expiration = null, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Fundamentals> GetFundamentalsAsync(string symbol, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<FinancialStatements> GetFinancialsAsync(string symbol, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<NewsItem>> GetNewsAsync(string symbol, int count = 20, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<SymbolMatch>> SearchAsync(string query, int limit = 10, CancellationToken ct = default) => throw new NotSupportedException();
    }

    private static (QuoteHub Hub, Counting Data, Func<DateTimeOffset> Clock, Action<double> Advance) Make()
    {
        var data = new Counting();
        var now = new DateTimeOffset(2026, 11, 12, 15, 0, 0, TimeSpan.Zero);
        var hub = new QuoteHub(data) { Now = () => now };
        return (hub, data, () => now, s => now = now.AddSeconds(s));
    }

    [Fact]
    public async Task Poll_fetches_the_union_of_all_subscribers_once_and_broadcasts()
    {
        var (hub, data, _, _) = Make();
        hub.Subscribe("dashboard", ["AAPL", "msft"]);
        hub.Subscribe("watchlist", ["MSFT", "NVDA"]);
        hub.Subscribe("alerts", ["aapl", "TSLA"]);
        QuoteBatch? seen = null;
        hub.Updated += (_, b) => seen = b;
        await hub.PollAsync();
        var call = Assert.Single(data.Calls);
        Assert.Equal(["AAPL", "MSFT", "NVDA", "TSLA"], call.Order(StringComparer.Ordinal));
        Assert.NotNull(seen);
        Assert.True(seen!.Covers("nvda"));
        Assert.Equal(100, seen.Find("tsla")!.Price);
    }

    [Fact]
    public async Task Poll_without_subscribers_does_nothing_and_unsubscribe_removes_symbols()
    {
        var (hub, data, _, _) = Make();
        Assert.Null(await hub.PollAsync());
        hub.Subscribe("a", ["AAPL"]);
        hub.Subscribe("b", ["MSFT"]);
        hub.Unsubscribe("a");
        await hub.PollAsync();
        Assert.Equal(["MSFT"], data.Calls.Single());
    }

    [Fact]
    public async Task Reads_within_ttl_come_from_memory_and_stale_subscribers_piggyback()
    {
        var (hub, data, _, advance) = Make();
        hub.Subscribe("alerts", ["TSLA"]);
        await hub.GetQuotesAsync(["AAPL"]);
        Assert.Equal(["AAPL", "TSLA"], data.Calls[0]);          // TSLA rode along
        advance(1);
        var q = await hub.GetQuotesAsync(["aapl", "TSLA"]);
        Assert.Equal(2, q.Count);
        Assert.Single(data.Calls);                              // both fresh: no request
        advance(2);
        await hub.GetQuotesAsync(["AAPL"]);
        Assert.Equal(2, data.Calls.Count);
    }

    [Fact]
    public async Task Concurrent_identical_reads_share_one_request()
    {
        var (hub, data, _, _) = Make();
        data.Gate = new TaskCompletionSource();
        var a = hub.GetQuotesAsync(["AAPL", "MSFT"]);
        var b = hub.GetQuotesAsync(["MSFT"]);
        data.Gate.SetResult();
        await Task.WhenAll(a, b);
        Assert.Single(data.Calls);
        Assert.Single(await b);
    }

    [Fact]
    public async Task Failures_are_counted_broadcast_and_reset_on_success()
    {
        var (hub, data, _, advance) = Make();
        hub.Subscribe("alerts", ["AAPL"]);
        data.Fail = new InvalidOperationException("down");
        var errors = 0;
        hub.Updated += (_, b) => { if (b.Error is not null) errors++; };
        await hub.PollAsync();
        await hub.PollAsync();
        Assert.Equal(2, hub.ConsecutiveFailures);
        Assert.Equal(2, errors);
        Assert.Equal("down", hub.LastError!.Message);
        await Assert.ThrowsAsync<InvalidOperationException>(() => hub.GetQuotesAsync(["MSFT"]));
        Assert.Equal(3, hub.ConsecutiveFailures);
        data.Fail = null;
        advance(10);
        await hub.PollAsync();
        Assert.Equal(0, hub.ConsecutiveFailures);
        Assert.NotNull(hub.LastSuccess);
        Assert.Null(hub.LastError);
    }

    [Fact]
    public async Task One_caller_cancelling_does_not_cancel_the_shared_request_for_the_others()
    {
        var (hub, data, _, _) = Make();
        data.HonorToken = true;
        data.Gate = new TaskCompletionSource();
        var updates = 0;
        hub.Updated += (_, _) => updates++;
        using var cts = new CancellationTokenSource();
        var first = hub.GetQuotesAsync(["AAPL"], cts.Token);
        var second = hub.GetQuotesAsync(["AAPL"]);
        cts.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first.WaitAsync(TimeSpan.FromSeconds(10)));
        data.Gate.SetResult();
        var quotes = await second.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal("AAPL", Assert.Single(quotes).Symbol);
        Assert.Single(data.Calls);
        Assert.Equal(1, updates);
        Assert.Equal(0, hub.ConsecutiveFailures);
        Assert.Null(hub.LastError);
    }

    [Fact]
    public async Task A_poll_cancelled_by_its_caller_leaves_the_request_running_for_everyone_else()
    {
        var (hub, data, _, _) = Make();
        data.HonorToken = true;
        data.Gate = new TaskCompletionSource();
        hub.Subscribe("alerts", ["AAPL"]);
        using var cts = new CancellationTokenSource();
        var poll = hub.PollAsync(cts.Token);
        var read = hub.GetQuotesAsync(["AAPL"]);
        cts.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => poll.WaitAsync(TimeSpan.FromSeconds(10)));
        data.Gate.SetResult();
        Assert.Single(await read.WaitAsync(TimeSpan.FromSeconds(10)));
        Assert.Single(data.Calls);
        Assert.Equal(0, hub.ConsecutiveFailures);
    }

    [Fact]
    public async Task The_shared_request_still_times_out_on_its_own_and_counts_as_a_failure()
    {
        var data = new Counting { HonorToken = true, Gate = new TaskCompletionSource() };
        var hub = new QuoteHub(data) { RequestTimeout = TimeSpan.FromMilliseconds(50) };
        var batchErrors = 0;
        hub.Updated += (_, b) => { if (b.Error is not null) batchErrors++; };
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => hub.GetQuotesAsync(["AAPL"]).WaitAsync(TimeSpan.FromSeconds(10)));
        Assert.Equal(1, hub.ConsecutiveFailures);
        Assert.Equal(1, batchErrors);
    }

    [Fact]
    public async Task Caller_cancellation_is_not_a_source_failure()
    {
        var (hub, data, _, _) = Make();
        data.Fail = new OperationCanceledException();
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        data.Fail = null;
        data.Gate = new TaskCompletionSource();
        var t = hub.GetQuotesAsync(["AAPL"], cts.Token);
        data.Gate.SetException(new OperationCanceledException(cts.Token));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => t);
        Assert.Equal(0, hub.ConsecutiveFailures);
    }
    [Fact] public async Task Cache_invalidation_retains_subscriptions_and_last_display_but_refetches()
    {
        var (hub, data, _, _) = Make(); hub.Subscribe("alerts", ["AAPL"]);
        await hub.GetQuotesAsync(["AAPL"]);
        Assert.Equal(1, hub.Clear(false).Invalidated);
        Assert.True(hub.TryGetCached("AAPL", out _)); Assert.Single(hub.SubscribedSymbols);
        await hub.GetQuotesAsync(["AAPL"]); Assert.Equal(2, data.Calls.Count);
    }
    [Fact] public async Task Clear_during_request_does_not_cancel_waiters_or_make_old_response_fresh()
    {
        var (hub, data, _, _) = Make(); var gate = new TaskCompletionSource(); data.Gate = gate;
        var updates = 0; hub.Updated += (_, _) => updates++;
        var pending = hub.GetQuotesAsync(["AAPL"]); hub.Clear(false); gate.SetResult();
        Assert.Single(await pending); Assert.Equal(1, hub.Inspect().Expired); Assert.Equal(0, updates);
        data.Gate = null; await hub.GetQuotesAsync(["AAPL"]); Assert.Equal(2, data.Calls.Count);
    }
    [Fact]public async Task Pushed_price_survives_late_rest_snapshot_and_unsubscribed_or_out_of_order_ticks_are_ignored()
    {
        var(hub,data,clock,_)=Make();hub.Subscribe("view",["AAPL"]);data.Gate=new TaskCompletionSource();
        var loading=hub.PollAsync();var tick=new QuoteTick("AAPL",102,clock(),MarketState.Regular,2,2,1000,Source:"yahoo");
        hub.ApplyTicks([tick]);data.Gate.SetResult();var response=await loading;
        Assert.Equal(102,Assert.Single(response!.Quotes).Price);Assert.True(hub.TryGetCached("AAPL",out var cached));Assert.Equal("websocket",cached.Delivery);Assert.False(cached.IsRealtime);Assert.Equal("yahoo",cached.Source);Assert.Equal("x",cached.SnapshotSource);Assert.Equal(clock(),cached.SnapshotFetchedAt);
        hub.ApplyTicks([tick with{Price=1,Time=clock().AddSeconds(-1)},tick with{Symbol="MSFT"},tick with{Price=double.NaN},tick with{Time=clock().AddMinutes(2)}]);
        Assert.True(hub.TryGetCached("AAPL",out cached));Assert.Equal(102,cached.Price);Assert.False(hub.TryGetCached("MSFT",out _));
        Assert.Equal(102,Assert.Single((await hub.PollAsync())!.Quotes).Price);Assert.Single(data.Calls); // Cached broadcast retains alert cadence without duplicate HTTP.
        hub.MarkStreamInterrupted(["AAPL"]);Assert.True(hub.TryGetCached("AAPL",out cached));Assert.Equal(102,cached.Price);Assert.Equal("reconnecting",cached.StreamState);
        hub.ApplyTicks([tick with{Time=clock().AddMilliseconds(1)}]);Assert.True(hub.TryGetCached("AAPL",out cached));Assert.Equal("active",cached.StreamState);
        hub.Unsubscribe("view");hub.ApplyTicks([tick with{Price=103,Time=clock().AddSeconds(1)}]);Assert.True(hub.TryGetCached("AAPL",out cached));Assert.Equal(102,cached.Price);
    }
    [Theory][InlineData(MarketState.PreMarket)][InlineData(MarketState.AfterHours)][InlineData(MarketState.Overnight)]public async Task Extended_push_retains_regular_close_and_source_then_new_regular_session_clears_extended_fields(MarketState session)
    {
        var(hub,_,clock,_)=Make();hub.Subscribe("view",["AAPL"]);await hub.PollAsync();
        var ext=new QuoteTick("AAPL",105,clock(),session,Source:"yahoo");hub.ApplyTicks([ext]);
        Assert.True(hub.TryGetCached("AAPL",out var cached));Assert.Equal(100,cached.Price);Assert.Equal(105,cached.ExtendedPrice);Assert.Equal("x",cached.Source);Assert.Equal("yahoo",cached.ExtendedSource);Assert.Equal("websocket",cached.ExtendedDelivery);
        hub.ApplyTicks([ext with{Price=1,Time=clock().AddSeconds(-1)}]);Assert.True(hub.TryGetCached("AAPL",out cached));Assert.Equal(105,cached.ExtendedPrice);
        hub.ApplyTicks([ext with{Session=MarketState.Regular,Time=clock().AddSeconds(-1),Price=1}]);Assert.True(hub.TryGetCached("AAPL",out cached));Assert.Equal(100,cached.Price);
        hub.ApplyTicks([ext with{Session=MarketState.Regular,Time=clock().AddSeconds(1),Price=106}]);Assert.True(hub.TryGetCached("AAPL",out cached));Assert.Equal(106,cached.Price);Assert.Null(cached.ExtendedPrice);Assert.Null(cached.ExtendedDelivery);
    }

    [Fact]public async Task Overnight_can_arrive_before_regular_reference_and_cache_reopen_does_not_lose_received_points()
    {
        var(hub,_,clock,advance)=Make();hub.Subscribe("menu",["AAPL"]);
        var tick=new QuoteTick("AAPL",105,clock().AddSeconds(1),MarketState.Overnight,1,1,Source:"yahoo");hub.ApplyTicks([tick]);
        Assert.True(hub.TryGetCached("AAPL",out var partial));Assert.True(double.IsNaN(partial.Price));Assert.Null(partial.AsOf);Assert.Equal(105,partial.ExtendedPrice);
        var received=partial.FetchedAt;advance(1);await hub.PollAsync();Assert.True(hub.TryGetCached("AAPL",out var combined));Assert.Equal(100,combined.Price);Assert.Equal(105,combined.ExtendedPrice);Assert.Equal(received,combined.FetchedAt);Assert.Equal(MarketState.Overnight,combined.MarketState);
        Assert.Single(hub.GetOvernightObservations("AAPL"));hub.Subscribe("panel",["AAPL"]);hub.Unsubscribe("panel");
        advance(1);hub.ApplyTicks([tick with{Time=clock(),Price=106}]);Assert.Equal(2,hub.GetOvernightObservations("AAPL").Count);
        Assert.Equal(2,hub.Clear(false).Removed);Assert.Empty(hub.GetOvernightObservations("AAPL"));Assert.True(hub.TryGetCached("AAPL",out _));Assert.Single(hub.SubscribedSymbols);
    }
}
