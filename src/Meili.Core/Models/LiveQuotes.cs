namespace Meili.Core.Models;

/// <summary>A source-timestamped last-price update. Transport does not assert exchange entitlement or latency.</summary>
public sealed record QuoteTick(string Symbol, double Price, DateTimeOffset Time, MarketState Session,
    double? Change = null, double? ChangePercent = null, double? Volume = null,
    string? Currency = null, string? Exchange = null, string? Name = null, string Source = "");
public sealed record LiveQuoteSample(string Transport, string Source, IReadOnlyList<QuoteTick> Ticks,
    IReadOnlyList<string> MissingSymbols, string Status, string? Error,
    string Coverage = "Last-price updates; inspect source timing and coverage. No tick is not proof of disconnection or zero price.",
    IReadOnlyList<StreamInterruption>? Interruptions = null,
    string Continuity = "Indicative last prices are not a complete trade tape. Reconnect gaps are not backfilled by snapshots.");
public sealed record StreamInterruption(DateTimeOffset At,string Reason);
