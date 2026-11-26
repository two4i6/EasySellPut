using Meili.Core.Abstractions;
using Meili.Core.Models;
namespace Meili.Testing;

public sealed class LiquidityFixture : ILiquiditySeriesSource
{
    private sealed class FixtureTime : TimeProvider { public override DateTimeOffset GetUtcNow()=>new(2026,11,16,12,0,0,TimeSpan.Zero); }
    public static TimeProvider Clock {get;}=new FixtureTime();
    public Task<LiquiditySeries> GetSeriesAsync(string id,CancellationToken ct=default)
    {
        ct.ThrowIfCancellationRequested();
        var value=id switch{"SOFR"=>4.01,"IORB"=>4.0,"EFFR"=>3.98,"RRPONTSYD"=>220.0,"WRESBAL"=>3100000.0,"WTREGEN"=>700000.0,"WALCL"=>6500000.0,_=>throw new ArgumentException("fixture series")};
        var rate=id is "SOFR" or "IORB" or "EFFR";var weekly=id is "WRESBAL" or "WTREGEN" or "WALCL";
        return Task.FromResult(new LiquiditySeries(id,rate?"percent":id=="RRPONTSYD"?"USD billions":"USD millions",weekly?"weekly":"daily",
            Enumerable.Range(0,weekly?70:20).Select(i=>new LiquidityObservation(new DateOnly(2026,11,13).AddDays(-(weekly?69:19)+i),value)).Where(p=>weekly?p.Date.DayOfWeek==DayOfWeek.Wednesday:id=="IORB"||p.Date.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday)).ToArray(),"fixture","https://fred.stlouisfed.org/series/"+id,new DateTimeOffset(2026,11,13,18,0,0,TimeSpan.Zero)));
    }
    public static BarSeries Bars(BarRequest request)
    {
        var symbols=new[]{"XLB","XLC","XLE","XLF","XLI","XLK","XLP","XLRE","XLU","XLV","XLY"};
        var index=Math.Max(0,Array.IndexOf(symbols,request.Symbol));
        var days=Enumerable.Range(0,40).Select(i=>new DateTimeOffset(2026,10,12,20,0,0,TimeSpan.Zero).AddDays(i)).Where(d=>d.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday)).Take(25).ToArray();
        return new(){Symbol=request.Symbol,Interval=BarInterval.Day1,Source="fixture",FetchedAt=new DateTimeOffset(2026,11,13,18,0,0,TimeSpan.Zero),Adjustment=PriceAdjustment.Split,
            Bars=days.Select((d,i)=>new Bar(d,100+i,102+i,99+i,101+i,i==24?1_000_000*(0.4+index*0.2):1_000_000)).ToArray()};
    }
}
