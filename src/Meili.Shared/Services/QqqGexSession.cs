using Meili.Core.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Meili.Automation;
using Meili.Data.Cache;
using Meili.Core.Quotes;

namespace Meili.Shared.Services;

/// <summary>Private cache-only viewer. No upstream requests or native JavaScript privileges.</summary>
public sealed class QqqGexSession : IDisposable
{
    private readonly TcpListener listener = new(IPAddress.Loopback, 0);
    private readonly CancellationTokenSource stop = new();
    private readonly SemaphoreSlim clients = new(8);
    private readonly string token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    private readonly QqqGexResponseStore? cache;
    private readonly string snapshot;
    private int diagnosticCount;
    private object? presentation;
    public void UpdatePresentation(ChartPalette palette){Volatile.Write(ref presentation,WebChartSnapshot.Theme(palette));NotifyDataUpdated();}
    private readonly QuoteHub? quotes;
    private readonly DesktopActivity? activity;
    private readonly string quoteOwner="qqq-gex-"+Guid.NewGuid().ToString("N");
    private bool liveQuotesRequested;
    private void QuoteActivity(object? sender,EventArgs e){if(liveQuotesRequested&&(activity?.AnyVisible??true))quotes?.Subscribe(quoteOwner,["QQQ"]);else quotes?.Unsubscribe(quoteOwner);}
    private long quoteRevision;
    private TaskCompletionSource<bool> quoteChanged=new(TaskCreationOptions.RunContinuationsAsynchronously);
    private void OnQuote(object? sender,QuoteBatch batch)
    {
        if(!batch.Covers("QQQ"))return;
        Interlocked.Increment(ref quoteRevision);var signal=Interlocked.Exchange(ref quoteChanged,new(TaskCreationOptions.RunContinuationsAsynchronously));signal.TrySetResult(true);
    }
    private object? LocalQuote()
    {
        if(quotes is null||!quotes.TryGetCached("QQQ",out var original))return null;
        var view=QuotePriceView.Select(original,DateTimeOffset.UtcNow);var quote=view.Snapshot;
        return new{quote.Symbol,quote.Price,quote.Change,quote.ChangePercent,quote.Source,quote.Delivery,quote.StreamState,quote.StreamStateAt,quote.AsOf,quote.FetchedAt,quote.DelayMinutes,quote.IsRealtime,session=view.Session.ToString(),regularReferencePrice=original.Price,regularAsOf=original.AsOf};
    }
    private readonly string? directory;
    private readonly QqqGexPreferences? preferences;
    private TaskCompletionSource<bool> changed=new(TaskCreationOptions.RunContinuationsAsynchronously);
    private QqqGexCaptureState captureState=new("idle");
    public void UpdateCaptureState(QqqGexCaptureState value){Volatile.Write(ref captureState,value);NotifyDataUpdated();}
    private object CaptureSnapshot(){var value=Volatile.Read(ref captureState);return new {phase=value.Phase,startedAt=value.StartedAt,updatedAt=value.UpdatedAt,sourceMarketAt=value.SourceMarketAt,delayMinutes=value.DelayMinutes,missingIv=value.MissingIv,capturedExpiries=value.CapturedExpiries,inputComplete=value.InputComplete,visible=activity?.AnyVisible??true};}
    // Bound expensive hydration/serialization across concurrent chart requests; event heartbeats use separate permits.
    private readonly SemaphoreSlim dataReadGate=new(1);
    private bool Ready()=>cache?.IsUnavailable!=true&&cache?.LatestLocalDate(DateTimeOffset.UtcNow) is not null;
    public void NotifyDataUpdated(){var old=Interlocked.Exchange(ref changed,new(TaskCreationOptions.RunContinuationsAsynchronously));old.TrySetResult(true);}
    public Uri PageUri { get; }
    public QqqGexSession(string? databasePath = null, string snapshot = "local", QuoteHub? quotes = null, DesktopActivity? activity = null)
    {
        this.snapshot=snapshot;this.quotes=quotes;this.activity=activity;if(activity is not null)activity.Changed+=QuoteActivity;if(quotes is not null)quotes.Updated+=OnQuote;directory=databasePath is null?null:Path.GetDirectoryName(Path.GetDirectoryName(Path.GetFullPath(databasePath)))!; if(databasePath is not null)cache=new QqqGexResponseStore(databasePath);
        preferences=directory is null?null:new QqqGexPreferences(directory);
        liveQuotesRequested=preferences is null;
        if(preferences is not null)try{liveQuotesRequested=preferences.Read().values.GetValueOrDefault("qqq-local:mode")=="latest";}catch(Exception ex)when(ex is IOException or System.Text.Json.JsonException or UnauthorizedAccessException){AppLog.Warn("qqq-gex","Quote demand preference unavailable; history mode stays passive",ex);}
        QuoteActivity(null,EventArgs.Empty);
        listener.Start();
        PageUri = new Uri($"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}/{token}/index.html");
        _ = Task.Run(Accept);
    }
    public bool IsPageUrl(string url) => Uri.TryCreate(url, UriKind.Absolute, out var u) && u.AbsoluteUri == PageUri.AbsoluteUri;
    private async Task Accept()
    {
        try { while (!stop.IsCancellationRequested) { await clients.WaitAsync(stop.Token); try { var c = await listener.AcceptTcpClientAsync(stop.Token); _ = Handle(c); } catch { clients.Release(); throw; } } }
        catch (OperationCanceledException) { } catch (SocketException) when (stop.IsCancellationRequested) { }
    }
    private async Task Handle(TcpClient client)
    {
        using (client)
        using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(stop.Token))
        try
        {
            deadline.CancelAfter(TimeSpan.FromSeconds(10)); var ct = deadline.Token;
            using var stream = client.GetStream(); var raw = new List<byte>(); var one = new byte[1];
            while (raw.Count < 16384) { if (await stream.ReadAsync(one, ct) == 0) return; raw.Add(one[0]); if (raw.Count >= 4 && raw[^4] == 13 && raw[^3] == 10 && raw[^2] == 13 && raw[^1] == 10) break; }
            var lines = Encoding.ASCII.GetString(raw.ToArray()).Split("\r\n"); var request = lines[0].Split(' ');
            var headers = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
            var requestTime=System.Diagnostics.Stopwatch.StartNew();
            Task Send(int status,string type,byte[] body,CancellationToken token)=>Reply(stream,status,type,body,token,AcceptsGzip(headers.GetValueOrDefault("Accept-Encoding")),requestTime.ElapsedMilliseconds);
            foreach(var line in lines.Skip(1).Where(x=>x.Length>0)) { var i=line.IndexOf(':'); if(i<=0 || !headers.TryAdd(line[..i],line[(i+1)..].Trim())) { await Send(400,"text/plain",[],ct);return; } }
            var origin=PageUri.GetLeftPart(UriPartial.Authority);
            var diagnosticWrite=request.Length==3&&request[0]=="POST"&&request[1]==$"/{token}/diagnostics";
            var preferenceWrite=request.Length==3&&request[0]=="POST"&&request[1]==$"/{token}/preferences";
            var localWrite=preferenceWrite||diagnosticWrite;
            if(raw.Count>=16384 || request.Length!=3 || request[0]!="GET"&&!localWrite || headers.GetValueOrDefault("Host")!=PageUri.Authority || !request[1].StartsWith($"/{token}/",StringComparison.Ordinal) || headers.ContainsKey("Transfer-Encoding") || !localWrite&&headers.ContainsKey("Content-Length") || headers.TryGetValue("Origin",out var sentOrigin)&&sentOrigin!=origin || headers.GetValueOrDefault("Sec-Fetch-Site")=="cross-site"||localWrite&&headers.GetValueOrDefault("Origin")!=origin) { await Send(403,"text/plain",[],ct);return; }
            var route=request[1][(token.Length+2)..].Split('?')[0];
            if(diagnosticWrite){
                if(Interlocked.Increment(ref diagnosticCount)>12){await Send(429,"application/json",[],ct);return;}
                if(!int.TryParse(headers.GetValueOrDefault("Content-Length"),out var count)||count is <1 or >4096||!(headers.GetValueOrDefault("Content-Type")??"").StartsWith("application/json",StringComparison.OrdinalIgnoreCase)){await Send(400,"application/json",[],ct);return;}
                var bytes=new byte[count];var offset=0;while(offset<count){var read=await stream.ReadAsync(bytes.AsMemory(offset),ct);if(read==0)return;offset+=read;}
                try{using var document=JsonDocument.Parse(bytes,new JsonDocumentOptions{MaxDepth=8});if(!AcceptDiagnostic(document.RootElement)){await Send(400,"application/json",[],ct);return;}}
                catch(JsonException){await Send(400,"application/json",[],ct);return;}
                await Send(200,"application/json",Encoding.UTF8.GetBytes("{\"accepted\":true}"),ct);return;
            }
            if(route=="presentation"){await Send(200,"application/json",JsonSerializer.SerializeToUtf8Bytes(Volatile.Read(ref presentation)),ct);return;}
            if(route=="preferences"){
                if(preferences is null){await Send(503,"application/json",Encoding.UTF8.GetBytes("{}"),ct);return;}
                try{
                    if(!preferenceWrite){await Send(200,"application/json",JsonSerializer.SerializeToUtf8Bytes(preferences.Read()),ct);return;}
                    var lengthText=headers.GetValueOrDefault("Content-Length")??"";if(lengthText.Length==0||lengthText.Any(c=>!char.IsAsciiDigit(c))||!int.TryParse(lengthText,out var length)||length is <1 or >65536||!(headers.GetValueOrDefault("Content-Type")??"").StartsWith("application/json",StringComparison.OrdinalIgnoreCase)){await Send(400,"application/json",Encoding.UTF8.GetBytes("{}"),ct);return;}
                    var body=new byte[length];var offset=0;while(offset<length){var count=await stream.ReadAsync(body.AsMemory(offset),ct);if(count==0){await Send(400,"application/json",Encoding.UTF8.GetBytes("{}"),ct);return;}offset+=count;}
                    using var json=JsonDocument.Parse(body);if(json.RootElement.ValueKind!=JsonValueKind.Object||json.RootElement.EnumerateObject().Count()!=2||json.RootElement.EnumerateObject().Select(p=>p.Name).Distinct().Count()!=2||json.RootElement.EnumerateObject().Any(p=>p.Name is not ("revision" or "changes")))throw new ArgumentException("Invalid preference envelope");
                    var revision=json.RootElement.GetProperty("revision").GetString()??"";var changes=json.RootElement.GetProperty("changes").Deserialize<Dictionary<string,string?>>()??throw new ArgumentException("Missing preference changes");
                    var state=preferences.Patch(revision,changes);
                    if(changes.TryGetValue("qqq-local:mode",out var mode)){liveQuotesRequested=mode=="latest";QuoteActivity(null,EventArgs.Empty);}
                    await Send(200,"application/json",JsonSerializer.SerializeToUtf8Bytes(state),ct);return;
                }catch(Meili.Core.Settings.DataConflictException){await Send(409,"application/json",Encoding.UTF8.GetBytes("{\"code\":\"VIEW_PREFERENCE_CONFLICT\"}"),ct);return;}
                catch(Exception ex)when(ex is ArgumentException or JsonException or InvalidOperationException or KeyNotFoundException){AppLog.Warn("qqq-gex","Rejected view preference: "+ex.GetType().Name);await Send(400,"application/json",Encoding.UTF8.GetBytes("{\"code\":\"INVALID_VIEW_PREFERENCE\"}"),ct);return;}
            }
            if(route=="quotes")
            {
                deadline.CancelAfter(TimeSpan.FromSeconds(20));
                var url=new Uri(PageUri,request[1]);var after=url.Query.StartsWith("?after=",StringComparison.Ordinal)&&long.TryParse(url.Query[7..],out var parsed)?parsed:-1;
                var signal=Volatile.Read(ref quoteChanged);
                if(Interlocked.Read(ref quoteRevision)==after){try{await signal.Task.WaitAsync(TimeSpan.FromSeconds(15),ct);}catch(TimeoutException){}}
                await Send(200,"application/json",JsonSerializer.SerializeToUtf8Bytes(new{revision=Interlocked.Read(ref quoteRevision),quote=LocalQuote()}),ct);return;
            }
            if(route=="events"){
                var url=new Uri(PageUri,request[1]);var after=url.Query.StartsWith("?after=",StringComparison.Ordinal)?Uri.UnescapeDataString(url.Query[7..]):"";var notification=Volatile.Read(ref changed);var storage=cache?.StorageHealth();var readable=cache?.IsUnavailable!=true;var version=readable?cache?.RevisionToken()??"":"storage-unavailable";
                if(version==after){try{await notification.Task.WaitAsync(TimeSpan.FromSeconds(5),ct);}catch(TimeoutException){}storage=cache?.StorageHealth();readable=cache?.IsUnavailable!=true;version=readable?cache?.RevisionToken()??"":"storage-unavailable";}
                await Send(200,"application/json",JsonSerializer.SerializeToUtf8Bytes(new {version,storage,ready=readable&&Ready(),capture=CaptureSnapshot(),presentation=Volatile.Read(ref presentation),partial=readable?cache?.LatestPartial():null,quote=LocalQuote(),latestDate=!readable||version==after?null:cache?.LatestLocalDate(DateTimeOffset.UtcNow)}),ct);return;
            }
            if(route=="api/analysis/qqq/cache-status"){var storage=cache?.StorageHealth();var ready=cache?.IsUnavailable!=true&&Ready();var value=Volatile.Read(ref captureState);var pending=value.Phase is "capturing" or "calculating" or "captured_input" or "enriching";await Send(200,"application/json",JsonSerializer.SerializeToUtf8Bytes(new {localOnly=true,status=cache?.IsUnavailable==true?"UNAVAILABLE":ready?"AVAILABLE":pending?"WARMING":"EMPTY",ready,pending,capture=CaptureSnapshot(),storage}),ct);return;}
            if(route=="api/analysis/qqq/local-quote"){await Send(200,"application/json",JsonSerializer.SerializeToUtf8Bytes(new {quote=LocalQuote()}),ct);return;}
            if(route=="api/analysis/qqq/local-state"){var storage=cache?.StorageHealth();var readable=cache?.IsUnavailable!=true;await Send(200,"application/json",JsonSerializer.SerializeToUtf8Bytes(new {storage,ready=readable&&Ready(),capture=CaptureSnapshot(),partial=readable?cache?.LatestPartial():null,latestDate=readable?cache?.LatestLocalDate(DateTimeOffset.UtcNow):null,localOnly=true,revision=readable?cache?.RevisionToken()??"":"storage-unavailable"}),ct);return;}
            if(route.StartsWith("api/",StringComparison.Ordinal)) {
                await dataReadGate.WaitAsync(ct);try{
                if(cache?.IsUnavailable==true){await Send(503,"application/json",Encoding.UTF8.GetBytes("{\"code\":\"GEX_STORAGE_UNAVAILABLE\",\"available\":false,\"complete\":false}"),ct);return;}
                var path="/"+request[1][(token.Length+2)..];
                var cached=cache?.Read(snapshot,path,DateTimeOffset.UtcNow)??cache?.ReadLocalDay(path,DateTimeOffset.UtcNow)??cache?.ReadSpreadQuote(path,DateTimeOffset.UtcNow)??cache?.ReadLifecycle(path);
                if(cached is null&&directory is not null&&(path.StartsWith("/api/analysis/qqq/pcs/backtest?",StringComparison.Ordinal)||path.StartsWith("/api/analysis/qqq/pcs?",StringComparison.Ordinal)||path.StartsWith("/api/analysis/qqq/gex/intraday-context?",StringComparison.Ordinal)||path.StartsWith("/api/analysis/qqq/gex/exposure?",StringComparison.Ordinal)||(path=="/api/analysis/qqq/pcs/local-decision"||path.StartsWith("/api/analysis/qqq/pcs/local-decision?",StringComparison.Ordinal)))){
                    var result=await QqqGexCalculationRunner.QueryAsync(directory,path,ct);var json=result is JsonElement element?element:JsonSerializer.SerializeToElement(result);
                    if(json.TryGetProperty("body",out var wireBody)&&json.TryGetProperty("contentType",out var wireType)){await Send(200,wireType.GetString()!,Encoding.UTF8.GetBytes(wireBody.GetString()!),ct);return;}
                    if((json.TryGetProperty("available",out var available)&&available.ValueKind==JsonValueKind.True)||json.TryGetProperty("intraday",out _)||json.TryGetProperty("currentBars",out _)){await Send(200,"application/json",Encoding.UTF8.GetBytes(json.GetRawText()),ct);return;}
                }
                if(cached is not null){await Send(200,cached.ContentType,Encoding.UTF8.GetBytes(cached.Body),ct);return;}
                await Send(503,"application/json",Encoding.UTF8.GetBytes("{\"error\":\"本地缓存中尚无该请求的数据\",\"code\":\"LOCAL_CACHE_MISS\",\"offline\":true}"),ct);return; }finally{dataReadGate.Release();}}
            if(route.Contains('/') || route.Contains("..")) { await Send(404,"text/plain",[],ct);return; }
            using var asset=typeof(QqqGexSession).Assembly.GetManifestResourceStream("QqqGex/"+route);
            if(asset is null) { await Send(404,"text/plain",[],ct);return; }
            using var memory=new MemoryStream();await asset.CopyToAsync(memory,ct);
            await Send(200,AssetType(route),memory.ToArray(),ct);
        }
        catch(Exception ex) when(ex is IOException or OperationCanceledException or SocketException or ArgumentException) { AppLog.Warn("qqq-gex","Local viewer request ended: "+ex.GetType().Name); }
        finally { clients.Release(); }
    }
    private static bool AcceptDiagnostic(JsonElement value)
    {
        if(value.ValueKind!=JsonValueKind.Object||value.EnumerateObject().Count()!=4||!value.TryGetProperty("code",out var code)||code.ValueKind!=JsonValueKind.String||code.GetString()!="RENDER_FAILED"||!value.TryGetProperty("type",out var type)||type.ValueKind!=JsonValueKind.String||type.GetString() is not ("Error" or "TypeError" or "RangeError" or "ReferenceError" or "SyntaxError")||!value.TryGetProperty("category",out var category)||category.ValueKind!=JsonValueKind.String||category.GetString() is not ("null_access" or "not_callable" or "range" or "unknown")||!value.TryGetProperty("frames",out var frames)||frames.ValueKind!=JsonValueKind.Array||frames.GetArrayLength()>4)return false;
        var positions=new List<string>();foreach(var frame in frames.EnumerateArray()){
            if(frame.ValueKind!=JsonValueKind.Object||frame.EnumerateObject().Count()!=3||!frame.TryGetProperty("asset",out var asset)||asset.ValueKind!=JsonValueKind.String||!System.Text.RegularExpressions.Regex.IsMatch(asset.GetString()!,"^[A-Za-z0-9_.-]{1,80}\\.m?js$")||!frame.TryGetProperty("line",out var line)||line.ValueKind!=JsonValueKind.Number||!line.TryGetInt32(out var row)||row is <1 or >10000000||!frame.TryGetProperty("column",out var column)||column.ValueKind!=JsonValueKind.Number||!column.TryGetInt32(out var col)||col is <1 or >10000000)return false;
            positions.Add(asset.GetString()+":"+row+":"+col);
        }
        AppLog.Warn("qqq-gex","Frontend "+type.GetString()+" "+category.GetString()+" "+string.Join(" ",positions));return true;
    }
    private static string AssetType(string route)=>Path.GetExtension(route) switch{".html"=>"text/html; charset=utf-8",".css"=>"text/css; charset=utf-8",".js" or ".mjs"=>"text/javascript; charset=utf-8",".woff2"=>"font/woff2",".woff"=>"font/woff",".svg"=>"image/svg+xml",_=>"application/octet-stream"};
    private static bool AcceptsGzip(string? value)=>value?.Split(',').Any(part=>System.Net.Http.Headers.StringWithQualityHeaderValue.TryParse(part.Trim(),out var token)&&token.Value.Equals("gzip",StringComparison.OrdinalIgnoreCase)&&(token.Quality??1)>0)==true;
    private static async Task Reply(Stream s,int status,string type,byte[] body,CancellationToken ct,bool gzip=false,long elapsed=0)
    {
        var encoding="";if(gzip&&status==200&&body.Length>=16384&&(type.Contains("json",StringComparison.Ordinal)||type.Contains("javascript",StringComparison.Ordinal)||type.StartsWith("text/",StringComparison.Ordinal))){using var output=new MemoryStream();using(var compressor=new System.IO.Compression.GZipStream(output,System.IO.Compression.CompressionLevel.Fastest,true))compressor.Write(body);body=output.ToArray();encoding="Content-Encoding: gzip\r\nVary: Accept-Encoding\r\n";}
        var csp="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
        await s.WriteAsync(Encoding.ASCII.GetBytes($"HTTP/1.1 {status} Response\r\nContent-Type: {type}\r\nContent-Length: {body.Length}\r\n{encoding}Server-Timing: local;dur={elapsed}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: {csp}\r\nConnection: close\r\n\r\n"),ct);await s.WriteAsync(body,ct);
    }
    public void Dispose(){if(quotes is not null)quotes.Updated-=OnQuote;if(activity is not null)activity.Changed-=QuoteActivity;quotes?.Unsubscribe(quoteOwner);stop.Cancel();listener.Stop();}
}
