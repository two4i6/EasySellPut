using Meili.Core.Abstractions;
using Meili.Core.Models;
using Meili.Data.Cache;
using Meili.Data.Http;
using Microsoft.Data.Sqlite;
namespace Meili.Data.Tests;

public sealed class CacheManagementTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), "cache-management-" + Guid.NewGuid().ToString("N"), "market.db");
    private static readonly DateTimeOffset Now = DateTimeOffset.UtcNow;
    private MarketDb Db() => new(_path);
    private static readonly Bar[] Bars = [new(Now, 1, 2, .5, 1.5, 100)];
    private static BarCacheMeta Meta => new("fixture", Now, Now, 15, false);
    public void Dispose() { SqliteConnection.ClearAllPools(); if (Directory.Exists(Path.GetDirectoryName(_path))) Directory.Delete(Path.GetDirectoryName(_path)!, true); }

    [Fact] public void Clearing_one_symbol_preserves_other_bars_and_all_historical_observations()
    {
        var db = Db();
        db.SaveBars("AAPL", BarInterval.Day1, Bars, Meta);
        db.SaveBars("MSFT", BarInterval.Day1, Bars, Meta);
        db.SaveBars("AAPL", BarInterval.Day1, Bars, Meta, "total");
        db.AddIvSample("AAPL", Now, "ATM", .25, "fixture");
        db.SaveOpenInterest("AAPL", new(2026, 11, 1), [("contract", 100)]);
        var removed = new MarketDb(_path).ClearBars("AAPL");
        Assert.Equal(2, removed.Removed);
        Assert.Empty(db.LoadBars("AAPL", BarInterval.Day1).Bars);
        Assert.Empty(db.LoadBars("AAPL", BarInterval.Day1, "total").Bars);
        Assert.Single(db.LoadBars("MSFT", BarInterval.Day1).Bars);
        Assert.Single(db.LoadIvSamples("AAPL", Now.AddDays(-1)));
        Assert.Equal(100, db.LoadPreviousOpenInterest("AAPL", new(2026, 11, 2))["contract"]);
        Assert.Equal(1, db.InspectCache().Entries);
    }

    [Fact] public void Separate_instances_cannot_restore_pre_clear_downloads_and_database_remains_usable()
    {
        var reader = Db(); var writer = Db();
        var generation = reader.CacheGeneration();
        writer.ClearBars();
        reader.SaveBars("AAPL", BarInterval.Day1, Bars, Meta, expectedGeneration: generation);
        reader.ReplaceTail("AAPL", BarInterval.Day1, "", Bars, null, null, Meta, generation);
        Assert.Empty(writer.LoadBars("AAPL", BarInterval.Day1).Bars);
        reader.SaveBars("AAPL", BarInterval.Day1, Bars, Meta, expectedGeneration: reader.CacheGeneration());
        Assert.Single(writer.LoadBars("AAPL", BarInterval.Day1).Bars);
    }

    [Fact] public async Task Clearing_inflight_responses_prevents_repopulation_without_cancelling_waiters_or_new_requests()
    {
        var cache = new ResponseCache();
        var ready = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var pending = cache.GetOrAddAsync("key", TimeSpan.FromMinutes(1), _ => ready.Task);
        cache.Clear();
        Assert.Equal("new", await cache.GetOrAddAsync("key", TimeSpan.FromMinutes(1), _ => Task.FromResult("new")));
        ready.SetResult("old"); Assert.Equal("old", await pending);
        Assert.True(cache.TryGet<string>("key", out var value)); Assert.Equal("new", value);
    }

    [Fact] public void Expired_eviction_preserves_live_entries_and_reports_lifetime_hits_and_misses()
    {
        var cache = new ResponseCache(); cache.Set("expired", "old", TimeSpan.FromSeconds(-1)); cache.Set("live", "new", TimeSpan.FromMinutes(10));
        Assert.False(cache.TryGet<string>("expired", out _)); Assert.True(cache.TryGet<string>("live", out _));
        var status = cache.Inspect(); Assert.Equal(2, status.Entries); Assert.Equal(1, status.Expired); Assert.Equal(1, status.Hits); Assert.Equal(1, status.Misses);
        Assert.Equal(1, cache.Clear(true).Removed); Assert.True(cache.TryGet<string>("live", out _));
    }
}
