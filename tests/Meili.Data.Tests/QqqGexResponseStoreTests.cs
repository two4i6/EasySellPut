using Meili.Data.Cache;
namespace Meili.Data.Tests;
public sealed class QqqGexResponseStoreTests
{
    [Fact] public void Responses_survive_restart_match_queries_and_expire()
    {
        var dir=Path.Combine(Path.GetTempPath(),Guid.NewGuid().ToString("N"));Directory.CreateDirectory(dir);var path=Path.Combine(dir,"cache.db");var now=DateTimeOffset.UtcNow;var body="{\"gex\":-123,\"missing\":[\"synthetic-gap\"]}";
        var store=new QqqGexResponseStore(path);store.Save("revision-one","/api/analysis/qqq/gex/day?date=2026-10-15&expiry=2026-10-15",new("application/json",body,"r1",now,now.AddMinutes(1)));
        var restarted=new QqqGexResponseStore(path);
        Assert.Equal(body,restarted.Read("revision-one","/api/analysis/qqq/gex/day?expiry=2026-10-15&date=2026-10-15&page=1",now)!.Body);
        Assert.Null(restarted.Read("revision-two","/api/analysis/qqq/gex/day?date=2026-10-15&expiry=2026-10-15",now));
        Assert.Null(restarted.Read("revision-one","/api/analysis/qqq/gex/day?date=2026-10-16&expiry=2026-10-15",now));
        Assert.Null(restarted.Read("revision-one","/api/analysis/qqq/gex/day?date=2026-10-15&expiry=2026-10-15",now.AddMinutes(2)));
        Assert.Throws<ArgumentException>(()=>QqqGexResponseStore.CanonicalKey("/api/analysis/qqq/gex/day?date=a&date=b"));
        Assert.Throws<ArgumentException>(()=>QqqGexResponseStore.CanonicalKey("/api/proxy/yahoo/quote-stream?symbol=QQQ"));
    }
    [Fact] public void Managed_eviction_preserves_observations_and_original_provider_bytes()
    {
        var path=Path.Combine(Path.GetTempPath(),Guid.NewGuid()+".db");var store=new QqqGexResponseStore(path);var now=DateTimeOffset.UtcNow;
        store.RecordProviderBody("fixture",System.Text.Encoding.UTF8.GetBytes("original-provider-body"),now,now);
        store.RecordObservedInput("{\"symbol\":\"QQQ\",\"captures\":[]}");
        store.Save("local","/api/analysis/qqq/gex/day?date=2026-01-02",new("application/json","{}","r1",now.AddHours(-2),now.AddHours(-1)));
        Assert.Equal(1,store.Inspect().Expired);Assert.Equal(1,store.Clear(true).Removed);Assert.Equal(0,store.Inspect().Entries);
        using var c=new Microsoft.Data.Sqlite.SqliteConnection("Data Source="+path);c.Open();using var cmd=c.CreateCommand();
        foreach(var table in new[]{"qqq_gex_provider_raw","qqq_gex_observed_inputs"}){cmd.CommandText="SELECT count(*) FROM "+table;Assert.Equal(1L,cmd.ExecuteScalar());}
    }
    [Fact] public void Wire_capacity_is_bounded_and_clear_advances_the_shared_generation()
    {
        var path=Path.Combine(Path.GetTempPath(),Guid.NewGuid()+".db");var store=new QqqGexResponseStore(path,32);var now=DateTimeOffset.UtcNow;
        foreach(var day in new[]{"01","02","03"})store.Save("local","/api/analysis/qqq/gex/day?date=2026-01-"+day,new("application/json",new string('x',20),"r1",now,now.AddHours(1)));
        Assert.Equal(1,store.Inspect().Entries);Assert.Equal(20,store.Inspect().SizeBytes);store.Clear(false);
        using var c=new Microsoft.Data.Sqlite.SqliteConnection("Data Source="+path);c.Open();using var cmd=c.CreateCommand();cmd.CommandText="SELECT generation FROM qqq_gex_cache_meta WHERE id=1";Assert.Equal(1L,cmd.ExecuteScalar());
    }
}
