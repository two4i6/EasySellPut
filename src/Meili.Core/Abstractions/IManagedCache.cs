namespace Meili.Core.Abstractions;

/// <summary>Application data caches only. Historical observations and browser profiles are never clear targets.</summary>
public sealed record CacheStatus(string Id, string Storage, string Scope, long Entries, long Expired,
    long? Hits, long? Misses, long? SizeBytes, string Policy, bool CanClear = true, long? SharedFileBytes = null, IReadOnlyDictionary<string,long>? RetainedBytes = null);
public sealed record CacheClearResult(string Id, long Removed, long Invalidated = 0, long ReclaimedBytes = 0, bool Compacted = false);
public interface IManagedCache
{
    string CacheId { get; }
    CacheStatus Inspect();
    CacheClearResult Clear(bool expiredOnly, string? symbol = null);
}

/// <summary>Explicit atomic SQLite compaction; no logical records are deleted.</summary>
public interface ICompactableCache : IManagedCache { CacheClearResult Compact(); }
