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
}
