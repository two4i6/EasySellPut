using Meili.Core.Abstractions;
using Meili.Data.Cache;
namespace Meili.Caching;
public sealed class BarCacheResource(MarketDb db) : IManagedCache
{
    public string CacheId => "bars";
    public CacheStatus Inspect() => db.InspectCache();
    public CacheClearResult Clear(bool expiredOnly, string? symbol = null) => expiredOnly ? new("bars", 0) : db.ClearBars(symbol);
}
