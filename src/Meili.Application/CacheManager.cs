using Meili.Core.Abstractions;

namespace Meili.Caching;

public sealed record CacheReport(IReadOnlyList<CacheStatus> Caches, string[] ProtectedData, string[] Excluded, StorageUsage? Storage = null);
/// <summary>Single allowlisted management boundary; never deletes files, browser profiles or historical observations.</summary>
public sealed class CacheManager
{
    private readonly IManagedCache[] _stores;
    private readonly string? _dataDirectory;
    public CacheManager(string dataDirectory, params IManagedCache[] stores) : this(stores) => _dataDirectory = dataDirectory;
    public CacheManager(params IManagedCache[] stores)
    {
        if (stores.Select(s => s.CacheId).Distinct().Count() != stores.Length) throw new ArgumentException("Duplicate cache id.");
        _stores = stores.ToArray();
    }
    public CacheReport Inspect(CancellationToken ct = default) => new(_stores.Select(s => s.Inspect()).ToArray(),
        ["iv_samples", "oi_daily", "qqq_gex_observations", "qqq_gex_raw_provenance", "qqq_gex_archives", "qqq_gex_daily_summaries", "qqq_gex_import_progress", "settings", "watchlists", "alerts", "drawings", "strategies", "bookmarks"],
        ["OS-owned WebView profiles/cookies", "UI page instances and personal web sessions", "provider authentication and health state", "update downloads"], _dataDirectory is null ? null : StorageInventory.Scan(_dataDirectory, ct));
    public IReadOnlyList<CacheClearResult> Clear(string category, bool expiredOnly = false, string? symbol = null)
    {
        var selected = category == "all" ? _stores : _stores.Where(s => s.CacheId == category).ToArray();
        if (selected.Length == 0) throw new ArgumentException("Cache category is not registered in this process.");
        if (symbol is not null && category != "bars") throw new ArgumentException("Symbol filtering requires category bars.");
        if (symbol is not null)
        {
            symbol = symbol.Trim().ToUpperInvariant();
            if (symbol.Length is < 1 or > 32 || symbol.Any(c => !char.IsAsciiLetterOrDigit(c) && !".^-=:_/".Contains(c))) throw new ArgumentException("Invalid symbol.");
        }
        if (selected.Any(s => !s.Inspect().CanClear)) throw new ArgumentException("Cache is read-only.");
        return selected.Select(s => s.Clear(expiredOnly, symbol)).ToArray();
    }
}
