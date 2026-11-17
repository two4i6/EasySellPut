namespace Meili.Core.Models;

/// <summary>Canonical provider candles plus a separately identified, incomplete observed-price tail.</summary>
public sealed record LiveBarView(BarSeries History,IReadOnlyList<Bar> ObservedTail,string Status,
    DateTimeOffset? MissingFrom,DateTimeOffset? MissingTo,string? ObservedSource,
    string Basis="Observed tail is close-only with unknown OHLC/volume, never fabricated complete candles. Missing source buckets are not forward-filled. Closed canonical provider bars replace overlapping observations. Overnight observed_partial retains received minute observations with original source times; it does not certify unavailable overnight history.");
public sealed record LiveBarsSample(LiveBarView View,LiveQuoteSample Stream);
