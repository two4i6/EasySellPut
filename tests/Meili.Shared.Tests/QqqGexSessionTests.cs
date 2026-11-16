using Meili.Data.Cache;
namespace Meili.Shared.Tests;
public sealed class QqqGexSessionTests
{
    [Fact] public async Task Viewer_serves_bundled_page_and_local_data_and_rejects_missing_or_foreign_access()
    {
        var path=Path.Combine(Path.GetTempPath(),Guid.NewGuid()+".db");var now=DateTimeOffset.UtcNow;var store=new QqqGexResponseStore(path);
        store.Save("local","/api/analysis/qqq/gex/day?date=2026-01-02",new("application/json","{\"fixture\":true}","fixture-r1",now,now.AddHours(1)));
        using var session=new QqqGexSession(path);using var http=new HttpClient();
        var state=await http.GetStringAsync(new Uri(session.PageUri,"api/analysis/qqq/local-state"));Assert.Contains("\"localOnly\":true",state);
        var page=await http.GetAsync(session.PageUri);Assert.True(page.IsSuccessStatusCode);Assert.Contains("main.js",await page.Content.ReadAsStringAsync());Assert.Contains("connect-src 'self'",page.Headers.GetValues("Content-Security-Policy").Single());
        var hit=await http.GetAsync(new Uri(session.PageUri,"api/analysis/qqq/gex/day?date=2026-01-02&page=1"));Assert.Equal("{\"fixture\":true}",await hit.Content.ReadAsStringAsync());
        var miss=await http.GetAsync(new Uri(session.PageUri,"api/analysis/qqq/gex/day?date=2026-01-03"));Assert.Equal(System.Net.HttpStatusCode.ServiceUnavailable,miss.StatusCode);Assert.Contains("LOCAL_CACHE_MISS",await miss.Content.ReadAsStringAsync());
        var forbidden=await http.GetAsync(new Uri(session.PageUri,"/api/analysis/qqq/gex/day"));Assert.Equal(System.Net.HttpStatusCode.Forbidden,forbidden.StatusCode);
        using var foreign=new HttpRequestMessage(HttpMethod.Get,session.PageUri);foreign.Headers.Add("Origin","https://foreign.example");Assert.Equal(System.Net.HttpStatusCode.Forbidden,(await http.SendAsync(foreign)).StatusCode);
    }
    [Fact] public async Task Local_change_notifications_wake_waiter_and_external_revisions_are_detected()
    {
        var path=Path.Combine(Path.GetTempPath(),Guid.NewGuid()+".db");var store=new QqqGexResponseStore(path);
        using var session=new QqqGexSession(path);using var http=new HttpClient{Timeout=TimeSpan.FromSeconds(8)};
        var initial=store.RevisionToken();
        var waiting=http.GetAsync(new Uri(session.PageUri,"events?after="+initial));
        // A notification may arrive before or after the HTTP request registers; revision is authoritative.
        using(var c=new Microsoft.Data.Sqlite.SqliteConnection("Data Source="+path)){
            c.Open();using var cmd=c.CreateCommand();cmd.CommandText="INSERT INTO qqq_gex_local_days VALUES('2020-01-02','r1','{}',0)";cmd.ExecuteNonQuery();
        }
        session.NotifyDataUpdated();
        using var response=await waiting;response.EnsureSuccessStatusCode();
        using var body=System.Text.Json.JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.NotEqual(initial,body.RootElement.GetProperty("version").GetString());
        Assert.Equal(System.Text.Json.JsonValueKind.Null,body.RootElement.GetProperty("latestDate").ValueKind);
        // External CLI writers do not call NotifyDataUpdated; their committed revision is still visible.
        var next=store.RevisionToken();
        using(var c=new Microsoft.Data.Sqlite.SqliteConnection("Data Source="+path)){
            c.Open();using var cmd=c.CreateCommand();cmd.CommandText="UPDATE qqq_gex_local_days SET revision='r2'";cmd.ExecuteNonQuery();
        }
        var external=await http.GetStringAsync(new Uri(session.PageUri,"events?after="+next));
        Assert.Contains(store.RevisionToken(),external);
    }
    [Fact] public async Task Shared_quote_subscription_follows_visible_demand_and_has_no_quote_timer()
    {
        var hub=new Meili.Core.Quotes.QuoteHub(null!);var activity=new DesktopActivity();
        using(var session=new QqqGexSession(quotes:hub,activity:activity)){
            Assert.Empty(hub.SubscribedSymbols);activity.SetVisible("test",true);Assert.Equal(new[]{"QQQ"},hub.SubscribedSymbols);
            using var http=new HttpClient();Assert.Contains("\"quote\":null",await http.GetStringAsync(new Uri(session.PageUri,"api/analysis/qqq/local-quote")));
            activity.SetVisible("test",false);Assert.Empty(hub.SubscribedSymbols);activity.SetVisible("test",true);
        }
        Assert.Empty(hub.SubscribedSymbols);
    }
}
