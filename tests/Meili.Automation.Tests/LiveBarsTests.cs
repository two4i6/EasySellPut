using Meili.Core.Models;
using Meili.Shared.Services;
using Meili.Testing;
namespace Meili.Automation.Tests;

public sealed class LiveBarsTests
{
    private static DateTimeOffset At(int minute)=>new(2026,11,16,15,minute,0,TimeSpan.Zero);
    [Fact]public void Scheduled_weekend_closure_is_not_a_missing_live_minute()
    {
        var friday=new DateTimeOffset(2026,11,14,0,59,0,TimeSpan.Zero); // Friday 19:59 Eastern.
        var monday=new DateTimeOffset(2026,11,16,9,0,0,TimeSpan.Zero); // Monday 04:00 Eastern.
        var join=new LiveBarStitcher();join.SetHistory(new(){Symbol="AAPL",Interval=BarInterval.Minute1,Source="yahoo",Bars=[new(friday,100,101,99,100,1000)]});
        join.Observe(new("AAPL",101,monday,MarketState.PreMarket,Source:"yahoo"));
        var view=join.View(monday);Assert.Equal("joined",view.Status);Assert.Null(view.MissingFrom);Assert.Equal(monday,Assert.Single(view.ObservedTail).Time);
    }
    [Fact]public void Quote_time_tail_from_legacy_cache_cannot_shift_bucket_grid_or_hide_newer_observation()
    {
        var history=LiveBarHistoryFixture.Series(new("AAPL",BarInterval.Minute1)) with{Source="yahoo",AsOf=At(30).AddSeconds(16)};
        history=history with{Bars=history.Bars.Append(new(At(30).AddSeconds(16),100,100,100,100,0)).ToArray()};
        var join=new LiveBarStitcher();join.SetHistory(history);
        join.Observe(new("AAPL",102,At(30).AddSeconds(10),MarketState.Regular,Source:"yahoo"));
        var result=join.View(At(30).AddSeconds(17));
        Assert.Equal("joined",result.Status);Assert.Equal(2,result.History.Bars.Count);
        Assert.Equal(At(30),Assert.Single(result.ObservedTail).Time);
        // A source-level quote timestamp does not prove each forming candle has incorporated that tick.
        join.SetHistory(history with{Bars=history.Bars.Where(b=>b.Time.Second==0).Append(new(At(30),99,101,98,100,10)).ToArray(),FetchedAt=At(30).AddSeconds(17)});
        Assert.Equal(102,Assert.Single(join.View(At(30).AddSeconds(18)).ObservedTail).Close);
    }
    [Fact]public void Same_bucket_and_next_bucket_join_without_duplicates_or_invented_ohlcv()
    {
        var join=new LiveBarStitcher();var history=LiveBarHistoryFixture.Series(new("AAPL",BarInterval.Minute1));join.SetHistory(history);
        join.Observe(new("AAPL",101,At(30),MarketState.Regular,Source:"fixture"));
        join.Observe(new("AAPL",102,At(30).AddSeconds(10),MarketState.Regular,Source:"fixture"));
        var result=join.View(At(30).AddSeconds(11));Assert.Equal("joined",result.Status);var bar=Assert.Single(result.ObservedTail);Assert.Equal(At(30),bar.Time);Assert.Equal(102,bar.Close);Assert.True(bar.Incomplete);Assert.True(double.IsNaN(bar.Open));Assert.True(double.IsNaN(bar.Volume));Assert.Equal(2,history.Bars.Count);
        join.Observe(new("AAPL",1,At(30).AddSeconds(1),MarketState.Regular,Source:"fixture"));Assert.Equal(102,Assert.Single(join.View(At(30).AddSeconds(12)).ObservedTail).Close);
    }
    [Fact]public void Reconnect_gap_is_explicit_until_overlapping_history_repair_then_closed_canonical_replaces_observed_bucket()
    {
        var join=new LiveBarStitcher();var history=LiveBarHistoryFixture.Series(new("AAPL",BarInterval.Minute1));join.SetHistory(history);
        join.Observe(new("AAPL",104,At(33),MarketState.Regular,Source:"fixture"));var missing=join.View(At(33));Assert.Equal("repairing",missing.Status);Assert.Empty(missing.ObservedTail);Assert.Equal(At(30),missing.MissingFrom);
        var repaired=history with{FetchedAt=At(33),Bars=history.Bars.Concat(Enumerable.Range(30,3).Select(i=>new Bar(At(i),100,105,99,103,1000))).ToArray()};
        join.SetHistory(repaired);var joined=join.View(At(33));Assert.Equal("joined",joined.Status);Assert.Single(joined.ObservedTail);Assert.Equal(At(33),joined.ObservedTail[0].Time);
        join.SetHistory(repaired with{FetchedAt=At(34),Bars=repaired.Bars.Append(new(At(33),103,106,102,105,2000)).ToArray()});var closed=join.View(At(34));Assert.Empty(closed.ObservedTail);Assert.Equal(105,closed.History.Bars[^1].Close);Assert.True(closed.History.Bars[^1].IsConsistent());
    }
    [Fact]public void Hourly_source_grid_uses_provider_half_hour_anchor_and_context_switch_clears_old_ticks()
    {
        var start=new DateTimeOffset(2026,11,16,14,30,0,TimeSpan.Zero);var history=new BarSeries{Symbol="AAPL",Interval=BarInterval.Hour1,Source="fixture",Bars=[new(start,100,101,99,100,1000)]};var join=new LiveBarStitcher();join.SetHistory(history);
        join.Observe(new("AAPL",102,start.AddMinutes(65),MarketState.Regular,Source:"fixture"));Assert.Equal(start.AddHours(1),Assert.Single(join.View(start.AddMinutes(65)).ObservedTail).Time);
        join.SetHistory(history with{Symbol="MSFT"});Assert.Empty(join.View(start.AddMinutes(65)).ObservedTail);
    }
    [Fact]public async Task Bounded_application_handoff_fetches_overlap_and_uses_same_projection_as_desktop()
    {
        var calls=0;var market=new FakeMarket{BarsOverride=(r,_)=>{calls++;return Task.FromResult(LiveBarHistoryFixture.Series(r));}};
        var result=await new LiveBarsService(market,new(new QuoteStreamFixture()),LiquidityFixture.Clock).SampleAsync("AAPL",BarInterval.Minute1,1,1);
        Assert.Equal(2,calls);Assert.Equal("joined",result.View.Status);Assert.Equal(101,Assert.Single(result.View.ObservedTail).Close);Assert.Equal("websocket",result.Stream.Transport);
    }
}
