using Meili.Core.Abstractions;
namespace Meili.Data.Cache;
// Only reproducible wire responses are evictable. Raw inputs, partial/full historical
// profiles, daily summaries and receipt provenance remain protected observations.
public sealed partial class QqqGexResponseStore : IManagedCache
{
    public string CacheId=>"qqq_gex_wire";
    public CacheStatus Inspect(){using var c=Open();using var cmd=c.CreateCommand();cmd.CommandText="SELECT COUNT(*),COALESCE(SUM(CASE WHEN expires_at<=$now THEN 1 ELSE 0 END),0),COALESCE(SUM(length(CAST(body AS BLOB))),0) FROM qqq_gex_wire";cmd.Parameters.AddWithValue("$now",DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());using var r=cmd.ExecuteReader();r.Read();return new(CacheId,"sqlite","shared data directory",r.GetInt64(0),r.GetInt64(1),null,null,r.GetInt64(2),"Exact derived wire variants; explicit expires_at and a maximum 256 MiB logical wire budget, oldest source times evicted first. Clearing preserves raw provider inputs, observations, full/partial days and summaries; regenerate through explicit local calculation.");}
    public CacheClearResult Clear(bool expiredOnly,string? symbol=null){if(symbol is not null)throw new ArgumentException("GEX wire cache does not support symbol filtering");using var c=Open();using var tx=c.BeginTransaction();using var cmd=c.CreateCommand();cmd.Transaction=tx;cmd.CommandText="DELETE FROM qqq_gex_wire"+(expiredOnly?" WHERE expires_at<=$now":"");if(expiredOnly)cmd.Parameters.AddWithValue("$now",DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());var count=cmd.ExecuteNonQuery();cmd.CommandText="UPDATE qqq_gex_cache_meta SET generation=generation+1 WHERE id=1";cmd.ExecuteNonQuery();cmd.CommandText="SELECT name FROM sqlite_master WHERE name='qqq_gex_import_receipts'";if(cmd.ExecuteScalar() is not null){cmd.CommandText="DELETE FROM qqq_gex_import_receipts";cmd.ExecuteNonQuery();}tx.Commit();return new(CacheId,count);}
}
