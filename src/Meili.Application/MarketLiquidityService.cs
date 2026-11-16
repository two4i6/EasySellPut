using Meili.Analytics;
using Meili.Core.Diagnostics;
using Meili.Core.Abstractions;
using Meili.Core.Models;
using Meili.Core.Time;
using Meili.Data.Providers.Fred;
namespace Meili.Shared.Services;

public sealed class MarketLiquidityService(ILiquiditySeriesSource macro, IMarketDataService market, TimeProvider? clock = null)
{
    public static readonly IReadOnlyList<(string Symbol,string Sector)> Universe = [("XLB","materials"),("XLC","communication"),("XLE","energy"),("XLF","financials"),("XLI","industrials"),("XLK","technology"),("XLP","staples"),("XLRE","real_estate"),("XLU","utilities"),("XLV","health_care"),("XLY","discretionary")];
    public async Task<LiquidityReport> LoadAsync(CancellationToken ct = default)
    {
        var now=(clock??TimeProvider.System).GetUtcNow();
        using var budget=CancellationTokenSource.CreateLinkedTokenSource(ct); budget.CancelAfter(TimeSpan.FromSeconds(58));
        var series=new LiquiditySeries[FredLiquidityProvider.Series.Count]; var sectors=new SectorLiquidity[Universe.Count];
        var ids=FredLiquidityProvider.Series.Keys.ToArray();
        await Parallel.ForEachAsync(Enumerable.Range(0,ids.Length+Universe.Count),new ParallelOptions{MaxDegreeOfParallelism=2,CancellationToken=budget.Token},async(i,token)=>
        {
            using var request=CancellationTokenSource.CreateLinkedTokenSource(token);request.CancelAfter(TimeSpan.FromSeconds(6));
            if(i<ids.Length)
            {
                var id=ids[i];
                try{series[i]=await macro.GetSeriesAsync(id,request.Token).ConfigureAwait(false);}
                catch(OperationCanceledException)when(token.IsCancellationRequested){throw;}
                catch(Exception ex){AppLog.Warn("liquidity", "Macro series unavailable: "+id, ex);var spec=FredLiquidityProvider.Series[id];series[i]=new(id,spec.Unit,spec.Frequency,[],"fred","https://fred.stlouisfed.org/series/"+id,null,ex is OperationCanceledException?"Source request timed out.":ex.GetType().Name);}
            }
            else
            {
                var index=i-ids.Length;var (symbol,sector)=Universe[index];
                try{var bars=await market.GetBarsAsync(new(symbol,BarInterval.Day1,now.AddDays(-120),now,AdjustMode.Split),request.Token).ConfigureAwait(false);sectors[index]=LiquidityProjection.Sector(symbol,sector,bars,now);}
                catch(OperationCanceledException)when(token.IsCancellationRequested){throw;}
                catch(Exception ex){AppLog.Warn("liquidity", "Sector bars unavailable: "+symbol, ex);sectors[index]=LiquidityProjection.Sector(symbol,sector,null,now,ex is OperationCanceledException?"Source request timed out.":ex.GetType().Name);}
            }
        }).ConfigureAwait(false);
        var generated = (clock??TimeProvider.System).GetUtcNow();
        var metrics = LiquidityProjection.Macro(series);
        return new(generated,metrics,sectors,LiquidityProjection.Pressure(metrics, generated));
    }
}
