using System.Globalization;
using Meili.Core.Abstractions;
using Meili.Core.Models;
using Meili.Data.Http;

namespace Meili.Data.Providers.Fred;

/// <summary>Allowlisted public FRED observations. Date-only observations are never download timestamps.</summary>
public sealed class FredLiquidityProvider(HttpGateway http, ResponseCache cache) : ProviderBase(http, cache), ILiquiditySeriesSource, IConnectivityProbe
{
    public override string Id => "fred";
    public override string DisplayName => "Federal Reserve · FRED";
    public override DataCapability Capabilities => DataCapability.MacroLiquidity;
    public static readonly IReadOnlyDictionary<string, (string Unit, string Frequency)> Series = new Dictionary<string, (string, string)>
    {
        ["SOFR"]=("percent","daily"), ["IORB"]=("percent","daily"), ["EFFR"]=("percent","daily"),
        ["RRPONTSYD"]=("USD billions","daily"), ["WRESBAL"]=("USD millions","weekly"),
        ["WTREGEN"]=("USD millions","weekly"), ["WALCL"]=("USD millions","weekly")
    };
    public async Task<bool> ProbeAsync(CancellationToken ct = default)
    {
        var from = DateTimeOffset.UtcNow.AddDays(-10).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var payload = await Http.GetAsync(Id, $"https://fred.stlouisfed.org/graph/fredgraph.csv?id=SOFR&cosd={from}", ct: ct,
            timeout: TimeSpan.FromSeconds(6), maxRetries: 0).ConfigureAwait(false);
        return Parse("SOFR", payload.Text(), DateTimeOffset.UtcNow).Observations.Count > 0;
    }
    public Task<LiquiditySeries> GetSeriesAsync(string id, CancellationToken ct = default)
    {
        if (!Series.TryGetValue(id, out var spec)) throw new ArgumentException("Unsupported FRED liquidity series.");
        return Cache.GetOrAddAsync("fred:liquidity:" + id, TimeSpan.FromMinutes(30), async token =>
        {
            var from = DateTimeOffset.UtcNow.AddDays(-180).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            var payload = await Http.GetAsync(Id, $"https://fred.stlouisfed.org/graph/fredgraph.csv?id={id}&cosd={from}", ct: token, timeout: TimeSpan.FromSeconds(8), maxRetries: 1).ConfigureAwait(false);
            var series = Parse(id, payload.Text(), DateTimeOffset.UtcNow);
            if (series.Observations.Count == 0) throw new DataSourceException(Id, DataErrorKind.NoData, "No published observations in the requested window.");
            return series;
        }, ct);
    }
    public static LiquiditySeries Parse(string id, string csv, DateTimeOffset fetchedAt)
    {
        if (!Series.TryGetValue(id, out var spec)) throw new ArgumentException("Unsupported FRED liquidity series.");
        var lines = csv.TrimStart('\ufeff').Split('\n', StringSplitOptions.RemoveEmptyEntries);
        if (lines.Length < 1 || lines[0].TrimEnd('\r') != "observation_date," + id) throw new FormatException("Invalid FRED observation CSV header.");
        var today = DateOnly.FromDateTime(Meili.Core.Time.MarketClock.ToEastern(fetchedAt));
        var points = new SortedDictionary<DateOnly, double>();
        foreach (var line in lines.Skip(1))
        {
            var fields = line.TrimEnd('\r').Split(',');
            if (fields.Length != 2 || !DateOnly.TryParseExact(fields[0], "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)) throw new FormatException("Invalid FRED observation date/columns.");
            if (fields[1] is "" or ".") continue;
            if (!double.TryParse(fields[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var value) || !double.IsFinite(value)) throw new FormatException("Invalid FRED observation value.");
            if (date <= today && date >= today.AddDays(-180)) points[date] = value;
        }
        return new(id, spec.Unit, spec.Frequency, points.Select(p => new LiquidityObservation(p.Key, p.Value)).ToArray(), "fred", "https://fred.stlouisfed.org/series/" + id, fetchedAt,
            points.Count == 0 ? "No published observations in the requested window." : null,
            id is "WRESBAL" or "WTREGEN" ? "Week average, ending Wednesday" : id == "WALCL" ? "Wednesday level" : "Daily published observation");
    }
}
