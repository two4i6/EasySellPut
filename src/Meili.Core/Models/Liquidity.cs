namespace Meili.Core.Models;

public sealed record LiquidityObservation(DateOnly Date, double Value);
public sealed record LiquiditySeries(string Id, string Unit, string Frequency, IReadOnlyList<LiquidityObservation> Observations,
    string Source, string SourceUrl, DateTimeOffset? FetchedAt, string? Error = null, string? ObservationBasis = null);
public sealed record LiquidityMetric(string Id, string Unit, string Frequency, IReadOnlyList<LiquidityObservation> Observations,
    IReadOnlyList<LiquiditySeries> Inputs, string? UnavailableReason)
{
    public LiquidityObservation? Latest => Observations.LastOrDefault();
}
public sealed record SectorLiquidity(string Symbol, string Sector, DateOnly? Date, double? DollarVolume,
    double? RelativeDollarVolume, double? AmihudPercentPerMillion, int BaselineDays, string Source,
    DateTimeOffset? FetchedAt, bool Offline, PriceAdjustment Adjustment, string? UnavailableReason);
public sealed record LiquidityReport(DateTimeOffset GeneratedAt, IReadOnlyList<LiquidityMetric> Metrics, IReadOnlyList<SectorLiquidity> Sectors,
    LiquidityPressureIndex PressureIndex,
    string HeatmapBasis = "US sector ETFs; previous completed daily bar; close × volume approximation / prior 20 observed trading bars; activity proxy, not executable depth or fund flows.");

public sealed record LiquidityPressureComponent(string Id, double Score, double Weight, double Input, string Unit, DateOnly Date, DateOnly? ComparisonDate = null);
public sealed record LiquidityPressureIndex(double? Score, string Band, string Method, IReadOnlyList<LiquidityPressureComponent> Components, string? UnavailableReason,
    string Interpretation = "Experimental funding-pressure heuristic, not VIX or an official/predictive panic index. Weights: SOFR-IORB 50%, EFFR-IORB 30%, four-observation reserve change 20%. Levels of RRP, TGA and Fed assets are context only, not monotonic stress inputs.",
    string Formula = "S=clamp(50+2*SOFR_IORB_bp,0,100); E=clamp(50+2*EFFR_IORB_bp,0,100); R=clamp(50-500*(reserve_latest/reserve_four_observations_prior-1),0,100); score=round(0.5*S+0.3*E+0.2*R,1). Bands: <30 loose; <60 normal; <80 tight; otherwise high. Funding maximum age 7 calendar days; reserves 21 calendar days.");
