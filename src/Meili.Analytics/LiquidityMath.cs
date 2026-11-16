namespace Meili.Analytics;

public sealed record LiquidityActivity(double DollarVolume, double RelativeDollarVolume, double AmihudPercentPerMillion);
public static class LiquidityMath
{
    public const double SofrWeight = 0.5, EffrWeight = 0.3, ReserveWeight = 0.2;
    public sealed record PressureResult(double Score, double SofrScore, double EffrScore, double ReserveScore);
    /// <summary>Version 1 heuristic: +/-25 bp maps to 0/100; +/-10% reserve change maps inversely to 0/100. No calibration claim.</summary>
    public static PressureResult? Pressure(double sofrBps, double effrBps, double reserveFractionChange)
    {
        if (!double.IsFinite(sofrBps) || !double.IsFinite(effrBps) || !double.IsFinite(reserveFractionChange)) return null;
        double Rate(double bp) => Math.Clamp(50 + 2 * bp, 0, 100);
        var sofr = Rate(sofrBps); var effr = Rate(effrBps); var reserves = Math.Clamp(50 - 500 * reserveFractionChange, 0, 100);
        return new(Math.Round(sofr * SofrWeight + effr * EffrWeight + reserves * ReserveWeight, 1), sofr, effr, reserves);
    }
    public static IReadOnlyList<(DateOnly Date, double Value)> Spread(IEnumerable<(DateOnly Date,double Value)> a, IEnumerable<(DateOnly Date,double Value)> b)
    {
        var right=b.Where(p=>double.IsFinite(p.Value)).GroupBy(p=>p.Date).ToDictionary(g=>g.Key,g=>g.Last().Value);
        return a.Where(p=>double.IsFinite(p.Value)&&right.ContainsKey(p.Date)).GroupBy(p=>p.Date).Select(g=>g.Last())
            .Select(p=>(p.Date,Value:(p.Value-right[p.Date])*100)).Where(p=>double.IsFinite(p.Value)).OrderBy(p=>p.Date).ToArray();
    }
    /// <summary>Latest close×volume divided by prior 20 observations. Amihud uses 20 absolute percent returns / dollar volume × 1m.</summary>
    public static LiquidityActivity? Activity(IReadOnlyList<(double Close,double Volume)> bars)
    {
        if(bars.Count<21)return null;
        var window=bars.TakeLast(21).ToArray();
        if(window.Any(b=>!double.IsFinite(b.Close)||b.Close<=0||!double.IsFinite(b.Volume)||b.Volume<=0))return null;
        var dollar=window[^1].Close*window[^1].Volume;
        var baseline=window.Take(20).Average(b=>b.Close*b.Volume);
        var impact=Enumerable.Range(1,20).Average(i=>Math.Abs(window[i].Close/window[i-1].Close-1)*100/(window[i].Close*window[i].Volume)*1_000_000);
        var ratio=dollar/baseline;
        return double.IsFinite(dollar)&&double.IsFinite(ratio)&&double.IsFinite(impact)&&baseline>0?new(dollar,ratio,impact):null;
    }
}
