using Meili.Core.Abstractions;
using Meili.Core.Models;

namespace Meili.Shared.Services;

/// <summary>D3: symbol search shared by every symbol box; remembers recent answers so retyping does not refetch.</summary>
public sealed class SymbolSearchService(IMarketDataService data) : IManagedCache
{
    public string CacheId => "search";
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(10);
    private readonly Meili.Data.Http.ResponseCache _cache = new() { MaxEntries = 200 };
    public CacheStatus Inspect() => _cache.Inspect() with { Id = "search", Policy = "Symbol search; TTL 10 minutes; capacity 200." };
    public CacheClearResult Clear(bool expiredOnly, string? symbol = null) => _cache.Clear(expiredOnly, symbol) with { Id = "search" };

    /// <summary>Hits for <paramref name="query"/>, or null when the search failed (the box then shows watch-list matches only).</summary>
    public async Task<IReadOnlyList<SymbolMatch>?> SearchAsync(string query, CancellationToken ct = default)
    {
        var q = query.Trim();
        if (q.Length == 0) return [];
        try { return await _cache.GetOrAddAsync(q.ToUpperInvariant(), Ttl, c => data.SearchAsync(q, 8, c), ct); }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            Meili.Core.Diagnostics.AppLog.Warn("search", $"symbol search '{q}' failed: {ex.Message}");
            return null;
        }
    }
}
