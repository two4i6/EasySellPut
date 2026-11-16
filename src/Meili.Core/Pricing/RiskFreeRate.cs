using Meili.Core.Abstractions;
using Meili.Core.Diagnostics;
using Meili.Core.Settings;

namespace Meili.Core.Pricing;

public enum RateOrigin
{
    /// <summary>13-week US T-bill yield (^IRX), fetched live.</summary>
    Treasury13Week,
    /// <summary>The user's fixed rate (chosen in settings).</summary>
    Fixed,
    /// <summary>^IRX was wanted but could not be fetched; the fixed rate is used instead.</summary>
    FixedFallback,
}

/// <summary>A risk-free rate as a decimal fraction (0.0412 = 4.12 %) and where it came from.</summary>
public sealed record RiskFreeRate(double Rate, RateOrigin Origin, DateTimeOffset? AsOf)
{
    public double Percent => Rate * 100;
}

/// <summary>
/// F5: one place that decides the risk-free rate for options and strategy pricing. In the default mode it reads the
/// 13-week T-bill yield (^IRX, quoted in percent) once and keeps it for <see cref="Ttl"/>; if that fails it falls back to
/// the configured fixed rate and says so, so the UI can label "r = x % (fixed fallback)".
/// </summary>
public sealed class RiskFreeRateProvider : IManagedCache
{
    public string CacheId => "rates";
    public const string TreasurySymbol = "^IRX";
    private readonly IMarketDataService _data;
    private readonly Func<PricingSettings> _settings;
    private RiskFreeRate? _cached;
    private DateTimeOffset _cachedAt;
    private DateTimeOffset _failedAt = DateTimeOffset.MinValue;

    private readonly object _cacheGate = new();
    private long _generation;
    public CacheStatus Inspect()
    {
        lock (_cacheGate) return new("rates", "memory", "process", _cached is null ? 0 : 1,
            _cached is not null && Now() - _cachedAt >= Ttl ? 1 : 0, null, null, null,
            "Treasury yield TTL 6 hours; retry failures after 15 minutes. User fixed rate is preserved.");
    }
    public CacheClearResult Clear(bool expiredOnly, string? symbol = null)
    {
        if (symbol is not null) throw new ArgumentException("Rate cache does not support symbol filtering.");
        lock (_cacheGate)
        {
            if (expiredOnly && (_cached is null || Now() - _cachedAt < Ttl)) return new("rates", 0);
            var count = _cached is null ? 0 : 1; _generation++; _cached = null; _cachedAt = DateTimeOffset.MinValue;
            if (!expiredOnly) _failedAt = DateTimeOffset.MinValue;
            return new("rates", count);
        }
    }

    public RiskFreeRateProvider(IMarketDataService data, Func<PricingSettings> settings)
    {
        _data = data;
        _settings = settings;
    }

    public TimeSpan Ttl { get; init; } = TimeSpan.FromHours(6);
    /// <summary>After a failed fetch, do not try again for this long (avoid a request per chain refresh when offline).</summary>
    public TimeSpan RetryAfterFailure { get; init; } = TimeSpan.FromMinutes(15);
    public Func<DateTimeOffset> Now { get; set; } = () => DateTimeOffset.UtcNow;

    /// <summary>The rate to use right now without waiting (last known, or the fixed rate).</summary>
    public RiskFreeRate Current
    {
        get
        {
            var s = _settings();
            if (s.RateMode == RiskFreeRateMode.Fixed) return Fixed(s, RateOrigin.Fixed);
            lock (_cacheGate) return _cached ?? Fixed(s, RateOrigin.FixedFallback);
        }
    }

    public async Task<RiskFreeRate> GetAsync(CancellationToken ct = default)
    {
        var s = _settings();
        if (s.RateMode == RiskFreeRateMode.Fixed) return Fixed(s, RateOrigin.Fixed);
        var now = Now();
        long generation;
        lock (_cacheGate)
        {
            generation = _generation;
            if (_cached is { } c && now - _cachedAt < Ttl) return c;
            if (now - _failedAt < RetryAfterFailure) return _cached ?? Fixed(s, RateOrigin.FixedFallback);
        }
        try
        {
            var quotes = await _data.GetQuotesAsync([TreasurySymbol], ct);
            var q = quotes.FirstOrDefault(x => string.Equals(x.Symbol, TreasurySymbol, StringComparison.OrdinalIgnoreCase));
            // ^IRX is quoted in percent (e.g. 4.12). Reject nonsense instead of pricing with it.
            if (q is { Price: > -1 and < 25 } && double.IsFinite(q.Price))
            {
                var result = new RiskFreeRate(q.Price / 100.0, RateOrigin.Treasury13Week, q.AsOf ?? now);
                lock (_cacheGate) if (generation == _generation) { _cached = result; _cachedAt = now; }
                return result;
            }
            AppLog.Warn("pricing", $"{TreasurySymbol} quote unusable: {q?.Price}");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex) { AppLog.Warn("pricing", $"{TreasurySymbol} fetch failed: {ex.Message}"); }
        lock (_cacheGate)
        {
            if (generation == _generation) _failedAt = now;
            return _cached ?? Fixed(s, RateOrigin.FixedFallback);
        }
    }

    private static RiskFreeRate Fixed(PricingSettings s, RateOrigin origin) => new(s.FixedRatePercent / 100.0, origin, null);
}
