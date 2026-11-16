using Meili.Analytics;
using Meili.Automation;
using Meili.Core.Models;
using Meili.Shared.Services;
using Meili.Testing;
using System.Text.Json;
namespace Meili.Automation.Tests;
public sealed class MarketLiquidityTests
{
    [Fact]public async Task Shared_report_has_six_dated_metrics_and_eleven_sector_proxies_with_identical_wire_contract()
    {
        var fixture=new LiquidityFixture();var market=new FakeMarket();var report=await new MarketLiquidityService(fixture,market,LiquidityFixture.Clock).LoadAsync();
        Assert.Equal(49.8,report.PressureIndex.Score);Assert.Equal("normal",report.PressureIndex.Band);Assert.Equal(3,report.PressureIndex.Components.Count);
        Assert.Equal(6,report.Metrics.Count);Assert.Equal(1,report.Metrics[0].Latest!.Value,8);Assert.Equal(-2,report.Metrics[1].Latest!.Value,8);
        Assert.Equal(3100,report.Metrics[3].Latest!.Value);Assert.All(report.Sectors,s=>{Assert.NotNull(s.RelativeDollarVolume);Assert.Equal(20,s.BaselineDays);Assert.Equal("fixture",s.Source);Assert.NotNull(s.Date);});
        Assert.Equal(11,report.Sectors.Count);Assert.False(OperationCatalog.Find("get_market_liquidity").Writes);
        var path=Path.Combine(Path.GetTempPath(),"liquidity-wire-"+Guid.NewGuid().ToString("N"));
        using var service=new AutomationService(new(path,Meili.Core.Settings.DataDirectorySource.CommandLine),market,liquiditySource:fixture,liquidityClock:LiquidityFixture.Clock);
        var wire=await service.ExecuteAsync("get_market_liquidity",JsonSerializer.SerializeToElement(new{}),false);
        Assert.Equal(6,wire.GetProperty("data").GetProperty("metrics").GetArrayLength());Assert.Equal(11,wire.GetProperty("data").GetProperty("sectors").GetArrayLength());
    }
    [Fact]public void Projection_keeps_missing_common_dates_and_today_partial_bars_out_and_converts_units()
    {
        var day=new DateOnly(2026,11,12);
        var macro=LiquidityProjection.Macro([new("SOFR","percent","daily",[new(day,4)],"test","",null),new("IORB","percent","daily",[new(day.AddDays(1),4)],"test","",null)]);
        Assert.Null(macro[0].Latest);Assert.NotNull(macro[0].UnavailableReason);
        var now=new DateTimeOffset(2026,11,16,18,0,0,TimeSpan.Zero);var bars=LiquidityFixture.Bars(new("XLK",BarInterval.Day1));
        var baseline=LiquidityProjection.Sector("XLK","technology",bars,now);
        var changed=bars with{Bars=bars.Bars.Concat([new(now,100,101,99,100,999_000_000)]).ToArray()};
        var actual=LiquidityProjection.Sector("XLK","technology",changed,now);Assert.Equal(baseline,actual);
        var invalid=bars with{Bars=bars.Bars.Take(bars.Bars.Count-1).Append(bars.Bars[^1] with {Volume=0}).ToArray()};
        Assert.Null(LiquidityProjection.Sector("XLK","technology",invalid,now).RelativeDollarVolume);
        Assert.True(LiquidityProjection.Sector("XLK","technology",bars with{OfflineCache=true},now).Offline);
        Assert.Null(LiquidityProjection.Sector("OTHER","technology",bars,now).RelativeDollarVolume);
        Assert.Null(LiquidityProjection.Sector("XLK","technology",bars with{Bars=[]},now).Date);
    }
    private sealed class BrokenMacro:Meili.Core.Abstractions.ILiquiditySeriesSource
    {public Task<LiquiditySeries> GetSeriesAsync(string id,CancellationToken ct=default)=>throw new IOException("offline");}
    [Fact]public async Task Partial_macro_failure_preserves_sector_data_and_cancellation_stays_cancellation()
    {
        var report=await new MarketLiquidityService(new BrokenMacro(),new FakeMarket()).LoadAsync();
        Assert.All(report.Metrics,m=>Assert.Null(m.Latest));Assert.All(report.Sectors,s=>Assert.NotNull(s.RelativeDollarVolume));
        using var stop=new CancellationTokenSource();stop.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>new MarketLiquidityService(new LiquidityFixture(),new FakeMarket()).LoadAsync(stop.Token));
    }
    [Fact]public async Task Pressure_rejects_missing_stale_or_future_inputs_and_retains_each_observation_date()
    {
        var report=await new MarketLiquidityService(new LiquidityFixture(),new FakeMarket(),LiquidityFixture.Clock).LoadAsync();
        var now=LiquidityFixture.Clock.GetUtcNow();
        Assert.Equal(1,report.PressureIndex.Components.Sum(c=>c.Weight));Assert.Contains("clamp",report.PressureIndex.Formula);
        Assert.NotEqual(report.PressureIndex.Components[0].Date,report.PressureIndex.Components[2].Date);
        Assert.Null(LiquidityProjection.Pressure(report.Metrics,now.AddDays(30)).Score);
        Assert.Null(LiquidityProjection.Pressure(report.Metrics.Where(m=>m.Id!="effr_iorb").ToArray(),now).Score);
        var incomplete=report.Metrics.Select(m=>m.Id=="reserves"?m with{Observations=m.Observations.TakeLast(4).ToArray()}:m).ToArray();
        Assert.Null(LiquidityProjection.Pressure(incomplete,now).Score);
        var future=report.Metrics.Select(m=>m.Id=="sofr_iorb"?m with{Observations=[new(DateOnly.FromDateTime(now.UtcDateTime).AddDays(1),1)]}:m).ToArray();
        Assert.Null(LiquidityProjection.Pressure(future,now).Score);
    }
}
