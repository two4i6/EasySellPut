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
    private sealed class CountingContext:SynchronizationContext
    {
        public int Posts;public override void Post(SendOrPostCallback callback,object? state){Interlocked.Increment(ref Posts);ThreadPool.QueueUserWorkItem(_=>callback(state));}
    }
    [Fact] public async Task Loopback_io_does_not_capture_the_desktop_synchronization_context()
    {
        var context=new CountingContext();var previous=SynchronizationContext.Current;QqqGexSession session;
        try{SynchronizationContext.SetSynchronizationContext(context);session=new QqqGexSession();}finally{SynchronizationContext.SetSynchronizationContext(previous);}
        using(session)using(var http=new HttpClient()){var result=await http.GetAsync(session.PageUri);result.EnsureSuccessStatusCode();Assert.Equal(0,context.Posts);}
    }
    [Fact] public async Task View_preferences_survive_ports_and_reject_conflicts_credentials_and_foreign_origins()
    {
        var directory=Path.Combine(Path.GetTempPath(),Guid.NewGuid().ToString());Directory.CreateDirectory(Path.Combine(directory,"cache"));var db=Path.Combine(directory,"cache","qqq-gex.db");
        using var session=new QqqGexSession(db);using var http=new HttpClient();
        var uri=new Uri(session.PageUri,"preferences");var initial=System.Text.Json.JsonSerializer.Deserialize<QqqGexPreferences.State>(await http.GetStringAsync(uri))!;
        async Task<System.Net.HttpStatusCode> Patch(string revision,Dictionary<string,string?> changes,string? origin=null){using var request=new HttpRequestMessage(HttpMethod.Post,uri);request.Headers.Add("Origin",origin??session.PageUri.GetLeftPart(UriPartial.Authority));request.Content=new StringContent(System.Text.Json.JsonSerializer.Serialize(new{revision,changes}),System.Text.Encoding.UTF8,"application/json");using var response=await http.SendAsync(request);return response.StatusCode;}
        Assert.Equal(System.Net.HttpStatusCode.OK,await Patch(initial.revision,new(){{"qqq-gex:snapshot-date:v1","2026-01-02"}}));
        Assert.Equal(System.Net.HttpStatusCode.Conflict,await Patch(initial.revision,new(){{"qqq-local:mode","latest"}}));
        var state=System.Text.Json.JsonSerializer.Deserialize<QqqGexPreferences.State>(await http.GetStringAsync(uri))!;
        Assert.Equal(System.Net.HttpStatusCode.BadRequest,await Patch(state.revision,new(){{"qqq-local:api_key","forbidden"}}));
        Assert.Equal(System.Net.HttpStatusCode.Forbidden,await Patch(state.revision,new(){{"qqq-local:mode","latest"}},"https://foreign.example"));
        using var reopened=new QqqGexSession(db);var restored=System.Text.Json.JsonSerializer.Deserialize<QqqGexPreferences.State>(await http.GetStringAsync(new Uri(reopened.PageUri,"preferences")))!;Assert.Equal("2026-01-02",restored.values["qqq-gex:snapshot-date:v1"]);Assert.Single(restored.values);
        var bytes=File.ReadAllText(Path.Combine(directory,"qqq-gex-view.json"));Assert.Throws<ArgumentException>(()=>new QqqGexPreferences(directory).Patch(state.revision,new(){{"qqq-local:mode",new string('x',8193)}}));Assert.Equal(bytes,File.ReadAllText(Path.Combine(directory,"qqq-gex-view.json")));
    }

    [Fact] public async Task Native_palette_is_readonly_and_updates_without_replacing_the_session()
    {
        using var session=new QqqGexSession();using var http=new HttpClient();var address=session.PageUri;
        var color=new ScottPlot.Color(1,2,3);session.UpdatePresentation(ChartPalette.Create(false,color,color,color,color,ThemePalette.Light));
        var body=await http.GetStringAsync(new Uri(address,"presentation"));Assert.Contains("\"dark\":false",body);Assert.Contains("#010203",body);
        session.UpdatePresentation(ChartPalette.Create(true,color,color,color,color,ThemePalette.Dark));Assert.Equal(address,session.PageUri);Assert.Contains("\"dark\":true",await http.GetStringAsync(new Uri(address,"presentation")));
    }

}
