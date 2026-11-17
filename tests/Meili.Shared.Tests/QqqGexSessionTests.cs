using Meili.Data.Cache;
namespace Meili.Shared.Tests;
public sealed class QqqGexSessionTests
{
    [Fact] public void Core_only_viewer_failure_releases_the_execution_lease()
    {
        var directory=Path.Combine(Path.GetTempPath(),"gex-core-view-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(Path.Combine(directory,"apps"));
        try
        {
            // Metadata fixture only; no executable package is loaded or trusted.
            File.WriteAllText(Path.Combine(directory,"apps","registry.json"),System.Text.Json.JsonSerializer.Serialize(new Meili.Automation.Modules.ModuleRegistryState(1,1,[new("easysellput.qqq-gex","1.0.0",new string('A',64),1,true,false)]),new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web)));
            Assert.Throws<InvalidOperationException>(()=>new QqqGexSession(Path.Combine(directory,"cache","qqq-gex.db")));
            Assert.Equal("uninstalled",new Meili.Automation.Modules.ModuleInstaller(directory).Uninstall("easysellput.qqq-gex").Status);
        }
        finally{Directory.Delete(directory,true);}
    }
    [Fact] public async Task Removed_desktop_only_history_route_is_not_exposed()
    {
        var path=Path.Combine(Path.GetTempPath(),Guid.NewGuid()+".db");using var session=new QqqGexSession(path);using var http=new HttpClient();var response=await http.GetAsync(new Uri(session.PageUri,"api/analysis/qqq/pcs/lifecycle?date=2026-01-02"));Assert.Equal(System.Net.HttpStatusCode.NotFound,response.StatusCode);
        // MCP still uses the retained store directly; an empty result never deletes retained observations.
        var local=new QqqGexResponseStore(path).ReadLifecycle("/api/analysis/qqq/pcs/lifecycle?date=2026-01-02");Assert.NotNull(local);Assert.Contains("\"recorded\":false",local.Body);
    }
    [Fact] public async Task Viewer_serves_bundled_page_and_local_data_and_rejects_missing_or_foreign_access()
    {
        var path=Path.Combine(Path.GetTempPath(),Guid.NewGuid()+".db");var now=DateTimeOffset.UtcNow;var store=new QqqGexResponseStore(path);
        store.Save("local","/api/analysis/qqq/gex/day?date=2026-01-02",new("application/json","{\"fixture\":true}","fixture-r1",now,now.AddHours(1)));
        using var session=new QqqGexSession(path);using var http=new HttpClient();
        var state=await http.GetStringAsync(new Uri(session.PageUri,"api/analysis/qqq/local-state"));Assert.Contains("\"localOnly\":true",state);
        Assert.DoesNotContain("QqqGex/build-manifest.json",typeof(QqqGexSession).Assembly.GetManifestResourceNames());
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

    [Fact] public async Task Corrupt_gex_database_preserves_file_and_keeps_shell_and_diagnostics_available()
    {
        var directory=Path.Combine(Path.GetTempPath(),Guid.NewGuid().ToString("N"),"cache");Directory.CreateDirectory(directory);var path=Path.Combine(directory,"qqq-gex.db");var original=System.Text.Encoding.UTF8.GetBytes("retained corrupt fixture");await File.WriteAllBytesAsync(path,original);
        using var session=new QqqGexSession(path);using var http=new HttpClient();(await http.GetAsync(session.PageUri)).EnsureSuccessStatusCode();
        using var state=System.Text.Json.JsonDocument.Parse(await http.GetStringAsync(new Uri(session.PageUri,"api/analysis/qqq/local-state")));Assert.False(state.RootElement.GetProperty("storage").GetProperty("canCapture").GetBoolean());Assert.Equal("storage_unavailable",state.RootElement.GetProperty("storage").GetProperty("error").GetString());
        var unavailable=await http.GetAsync(new Uri(session.PageUri,"api/analysis/qqq/pcs?gexWindow=latest"));Assert.Equal(System.Net.HttpStatusCode.ServiceUnavailable,unavailable.StatusCode);await using var file=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete);using var bytes=new MemoryStream();await file.CopyToAsync(bytes);Assert.Equal(original,bytes.ToArray());
    }
    [Fact] public async Task Capture_phase_does_not_claim_readable_page_before_verified_publication()
    {
        var path=Path.Combine(Path.GetTempPath(),Guid.NewGuid()+".db");using var session=new QqqGexSession(path);using var http=new HttpClient();
        foreach(var phase in new[]{"idle","capturing","calculating","imported","partial","failed"}){
            session.UpdateCaptureState(new(phase,DateTimeOffset.UtcNow,MissingIv:3,DelayMinutes:15,InputComplete:false));
            using var data=System.Text.Json.JsonDocument.Parse(await http.GetStringAsync(new Uri(session.PageUri,"api/analysis/qqq/cache-status")));Assert.False(data.RootElement.GetProperty("ready").GetBoolean());Assert.Equal(phase,data.RootElement.GetProperty("capture").GetProperty("phase").GetString());Assert.Equal(phase is "capturing" or "calculating",data.RootElement.GetProperty("pending").GetBoolean());Assert.NotEqual("AVAILABLE",data.RootElement.GetProperty("status").GetString());
        }
    }
    [Fact] public async Task Hidden_collector_pauses_and_visible_demand_wakes_without_waiting_two_minutes()
    {
        var activity=new DesktopActivity();var market=new PricingSnapshotTests.SnapshotData{Chain=new Meili.Core.Models.OptionChain{Underlying="QQQ",Contracts=[],Expirations=[]}};
        using var collector=new QqqGexActivity(market,Path.Combine(Path.GetTempPath(),Guid.NewGuid().ToString("N")),activity);var paused=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);var capturing=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        collector.StateChanged+=()=>{if(collector.Status=="paused")paused.TrySetResult();if(collector.Status=="capturing")capturing.TrySetResult();};collector.Start();await paused.Task.WaitAsync(TimeSpan.FromSeconds(5));Assert.False(capturing.Task.IsCompleted);activity.SetVisible("test",true);await capturing.Task.WaitAsync(TimeSpan.FromSeconds(5));
    }
    [Fact] public async Task Large_local_responses_negotiate_lossless_gzip_and_honor_disabled_encoding()
    {
        var path=Path.Combine(Path.GetTempPath(),Guid.NewGuid()+".db");var store=new QqqGexResponseStore(path);var body="{\"syntheticTransportFixture\":\""+new string('x',200000)+"\"}";const string route="api/analysis/qqq/pcs?fixture=1";store.Save("local","/"+route,new("application/json",body,"fixture",DateTimeOffset.UtcNow,DateTimeOffset.MaxValue));using var session=new QqqGexSession(path);using var http=new HttpClient();
        using var request=new HttpRequestMessage(HttpMethod.Get,new Uri(session.PageUri,route));request.Headers.TryAddWithoutValidation("Accept-Encoding","gzip");using var response=await http.SendAsync(request);Assert.Contains("gzip",response.Content.Headers.ContentEncoding);var compressed=await response.Content.ReadAsByteArrayAsync();Assert.True(compressed.Length<body.Length/10);using var zipped=new System.IO.Compression.GZipStream(new MemoryStream(compressed),System.IO.Compression.CompressionMode.Decompress);using var reader=new StreamReader(zipped);Assert.Equal(body,await reader.ReadToEndAsync());Assert.True(response.Headers.Contains("Server-Timing"));
        using var disabled=new HttpRequestMessage(HttpMethod.Get,new Uri(session.PageUri,route));disabled.Headers.TryAddWithoutValidation("Accept-Encoding","gzip;q=0");using var plain=await http.SendAsync(disabled);Assert.Empty(plain.Content.Headers.ContentEncoding);Assert.Equal(body,await plain.Content.ReadAsStringAsync());
    }
    [Fact] public async Task Renderer_diagnostics_are_bounded_typed_and_reject_raw_payloads_or_foreign_origin()
    {
        using var session=new QqqGexSession();using var http=new HttpClient();var uri=new Uri(session.PageUri,"diagnostics");const string body="{\"code\":\"RENDER_FAILED\",\"type\":\"TypeError\",\"category\":\"null_access\",\"frames\":[{\"asset\":\"main.js\",\"line\":1,\"column\":77}]}";
        async Task<System.Net.HttpStatusCode> Post(string payload,string origin){using var request=new HttpRequestMessage(HttpMethod.Post,uri){Content=new StringContent(payload,System.Text.Encoding.UTF8,"application/json")};request.Headers.Add("Origin",origin);using var response=await http.SendAsync(request);return response.StatusCode;}
        Assert.Equal(System.Net.HttpStatusCode.OK,await Post(body,session.PageUri.GetLeftPart(UriPartial.Authority)));Assert.Equal(System.Net.HttpStatusCode.BadRequest,await Post(body[..^1]+",\"message\":\"Bearer secret-token\"}",session.PageUri.GetLeftPart(UriPartial.Authority)));Assert.Equal(System.Net.HttpStatusCode.Forbidden,await Post(body,"https://foreign.example"));
    }
    [Fact]public async Task Live_quote_long_poll_wakes_from_shared_hub_without_revising_archives_and_history_releases_demand()
    {
        var directory=Path.Combine(Path.GetTempPath(),"gex-live-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(Path.Combine(directory,"cache"));
        var db=Path.Combine(directory,"cache","qqq-gex.db");var hub=new Meili.Core.Quotes.QuoteHub(new PricingSnapshotTests.SnapshotData());var activity=new DesktopActivity();activity.SetVisible("test",true);
        using var session=new QqqGexSession(db,quotes:hub,activity:activity);using var http=new HttpClient();
        Assert.Empty(hub.SubscribedSymbols); // A history-only page must not create a streaming subscription.
        async Task Mode(string mode)
        {
            var prefs=System.Text.Json.JsonSerializer.Deserialize<QqqGexPreferences.State>(await http.GetStringAsync(new Uri(session.PageUri,"preferences")))!;
            using var request=new HttpRequestMessage(HttpMethod.Post,new Uri(session.PageUri,"preferences"));request.Headers.Add("Origin",session.PageUri.GetLeftPart(UriPartial.Authority));
            request.Content=new StringContent(System.Text.Json.JsonSerializer.Serialize(new{revision=prefs.revision,changes=new Dictionary<string,string>{{"qqq-local:mode",mode}}}),System.Text.Encoding.UTF8,"application/json");
            (await http.SendAsync(request)).EnsureSuccessStatusCode();
        }
        await Mode("latest");Assert.Equal(["QQQ"],hub.SubscribedSymbols);
        var archiveRevision=new QqqGexResponseStore(db).RevisionToken();
        var waiting=http.GetStringAsync(new Uri(session.PageUri,"quotes?after=0"));
        hub.ApplyTicks([new("QQQ",503,DateTimeOffset.UtcNow,Meili.Core.Models.MarketState.Regular,Source:"yahoo")]);
        using(var response=System.Text.Json.JsonDocument.Parse(await waiting.WaitAsync(TimeSpan.FromSeconds(3))))
        {var quote=response.RootElement.GetProperty("quote");Assert.Equal(503,quote.GetProperty("Price").GetDouble());Assert.Equal("websocket",quote.GetProperty("Delivery").GetString());Assert.Equal(1,response.RootElement.GetProperty("revision").GetInt64());}
        Assert.Equal(archiveRevision,new QqqGexResponseStore(db).RevisionToken());
        await Mode("history");Assert.Empty(hub.SubscribedSymbols);
    }

}
