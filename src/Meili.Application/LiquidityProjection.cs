using Meili.Core.Models;
using Meili.Core.Time;
using Meili.Analytics;
namespace Meili.Shared.Services;

public static class LiquidityProjection
{
    public static IReadOnlyList<LiquidityMetric> Macro(IReadOnlyList<LiquiditySeries> series)
    {
        LiquiditySeries Get(string id) => series.FirstOrDefault(s => s.Id == id) ?? new(id, "", "", [], "fred", "https://fred.stlouisfed.org/series/" + id, null, "Series unavailable.");
        LiquidityMetric Spread(string id, string first)
        {
            var a = Get(first); var b = Get("IORB");
            var observations = LiquidityMath.Spread(a.Observations.Select(p=>(p.Date,p.Value)), b.Observations.Select(p=>(p.Date,p.Value)))
                .Select(p=>new LiquidityObservation(p.Date,p.Value)).ToArray();
            return new(id,"basis points","daily",observations,[a,b],observations.Length==0?"No common published observation dates; no forward fill.":null);
        }
        LiquidityMetric Level(string id, string source, double divisor)
        {
            var input = Get(source);
            var points = input.Observations.Where(p=>double.IsFinite(p.Value)).Select(p=>p with { Value=p.Value/divisor }).OrderBy(p=>p.Date).ToArray();
            return new(id,"USD billions",input.Frequency,points,[input],points.Length==0?input.Error??"No observations.":null);
        }
        return [Spread("sofr_iorb","SOFR"),Spread("effr_iorb","EFFR"),Level("on_rrp","RRPONTSYD",1),Level("reserves","WRESBAL",1000),Level("tga","WTREGEN",1000),Level("fed_assets","WALCL",1000)];
    }

    public static LiquidityPressureIndex Pressure(IReadOnlyList<LiquidityMetric> metrics, DateTimeOffset now)
    {
        const string method = "funding-pressure-v1";
        LiquidityPressureIndex Missing(string reason) => new(null, "unavailable", method, [], reason);
        var sofr = metrics.FirstOrDefault(m => m.Id == "sofr_iorb")?.Latest;
        var effr = metrics.FirstOrDefault(m => m.Id == "effr_iorb")?.Latest;
        var reserves = metrics.FirstOrDefault(m => m.Id == "reserves")?.Observations;
        if (sofr is null || effr is null || reserves is null || reserves.Count < 5) return Missing("Requires both dated funding spreads and five weekly reserve observations.");
        var current = reserves[^1]; var previous = reserves[^5];
        var today = DateOnly.FromDateTime(MarketClock.ToEastern(now));
        if (new[] { sofr.Date, effr.Date, current.Date }.Any(d => d > today) || today.DayNumber - sofr.Date.DayNumber > 7 || today.DayNumber - effr.Date.DayNumber > 7 || today.DayNumber - current.Date.DayNumber > 21)
            return Missing("Funding observations older than 7 days or reserve observations older than 21 days; no current score.");
        if (previous.Value <= 0 || current.Value <= 0) return Missing("Positive reserve baseline is required.");
        var change = current.Value / previous.Value - 1;
        var result = LiquidityMath.Pressure(sofr.Value, effr.Value, change);
        if (result is null) return Missing("Non-finite pressure inputs.");
        var band = result.Score < 30 ? "loose" : result.Score < 60 ? "normal" : result.Score < 80 ? "tight" : "high";
        return new(result.Score, band, method,
            [new("sofr_iorb", result.SofrScore, LiquidityMath.SofrWeight, sofr.Value, "basis points", sofr.Date),
             new("effr_iorb", result.EffrScore, LiquidityMath.EffrWeight, effr.Value, "basis points", effr.Date),
             new("reserve_change", result.ReserveScore, LiquidityMath.ReserveWeight, change, "fraction", current.Date, previous.Date)], null);
    }

    public static SectorLiquidity Sector(string symbol, string sector, BarSeries? series, DateTimeOffset now, string? error = null)
    {
        SectorLiquidity Empty(string reason) => new(symbol,sector,null,null,null,null,0,series?.Source??"",series?.FetchedAt,series?.OfflineCache??false,series?.Adjustment??PriceAdjustment.Unknown,reason);
        if (series is null || series.Interval != BarInterval.Day1 || !series.Symbol.Equals(symbol,StringComparison.OrdinalIgnoreCase)) return Empty(error??"Daily bars unavailable.");
        var today = DateOnly.FromDateTime(MarketClock.ToEastern(now));
        var bars = series.Bars.Where(b=>DateOnly.FromDateTime(MarketClock.ToEastern(b.Time))<today)
            .GroupBy(b=>DateOnly.FromDateTime(MarketClock.ToEastern(b.Time))).Select(g=>g.OrderBy(b=>b.Time).Last()).OrderBy(b=>b.Time).ToArray();
        if (bars.Length < 21) return Empty("Requires 21 completed daily bars with positive close and volume.") with { BaselineDays=Math.Max(0,bars.Length-1) };
        var last = bars[^1];
        var stats=LiquidityMath.Activity(bars.Select(b=>(b.Close,b.Volume)).ToArray());
        if (stats is null) return Empty("Non-finite turnover calculation.");
        return new(symbol,sector,DateOnly.FromDateTime(MarketClock.ToEastern(last.Time)),stats.DollarVolume,stats.RelativeDollarVolume,stats.AmihudPercentPerMillion,20,series.Source,series.FetchedAt,series.OfflineCache,series.Adjustment,null);
    }
}
