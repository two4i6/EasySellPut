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
    private readonly QuoteHub? quotes;
    private readonly DesktopActivity? activity;
    private readonly string quoteOwner="qqq-gex-"+Guid.NewGuid().ToString("N");
    private void QuoteActivity(object? sender,EventArgs e){if(activity?.AnyVisible??true)quotes?.Subscribe(quoteOwner,["QQQ"]);else quotes?.Unsubscribe(quoteOwner);}
    private object? LocalQuote()=>quotes is not null&&quotes.TryGetCached("QQQ",out var quote)?new {quote.Symbol,quote.Price,quote.Source,quote.AsOf,quote.FetchedAt,quote.DelayMinutes,quote.IsRealtime}:null;
    private readonly string? directory;
    private readonly QqqGexPreferences? preferences;
    private TaskCompletionSource<bool> changed=new(TaskCreationOptions.RunContinuationsAsynchronously);
    public void NotifyDataUpdated(){var old=Interlocked.Exchange(ref changed,new(TaskCreationOptions.RunContinuationsAsynchronously));old.TrySetResult(true);}
    public Uri PageUri { get; }
    public QqqGexSession(string? databasePath = null, string snapshot = "local", QuoteHub? quotes = null, DesktopActivity? activity = null)
    {
        this.snapshot=snapshot;this.quotes=quotes;this.activity=activity;if(activity is not null)activity.Changed+=QuoteActivity;QuoteActivity(null,EventArgs.Empty);directory=databasePath is null?null:Path.GetDirectoryName(Path.GetDirectoryName(Path.GetFullPath(databasePath)))!; if(databasePath is not null)cache=new QqqGexResponseStore(databasePath);
        preferences=directory is null?null:new QqqGexPreferences(directory);
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
            foreach(var line in lines.Skip(1).Where(x=>x.Length>0)) { var i=line.IndexOf(':'); if(i<=0 || !headers.TryAdd(line[..i],line[(i+1)..].Trim())) { await Reply(stream,400,"text/plain",[],ct);return; } }
            var origin=PageUri.GetLeftPart(UriPartial.Authority);
            var preferenceWrite=request.Length==3&&request[0]=="POST"&&request[1]==$"/{token}/preferences";
            if(raw.Count>=16384 || request.Length!=3 || request[0]!="GET"&&!preferenceWrite || headers.GetValueOrDefault("Host")!=PageUri.Authority || !request[1].StartsWith($"/{token}/",StringComparison.Ordinal) || headers.ContainsKey("Transfer-Encoding") || !preferenceWrite&&headers.ContainsKey("Content-Length") || headers.TryGetValue("Origin",out var sentOrigin)&&sentOrigin!=origin || headers.GetValueOrDefault("Sec-Fetch-Site")=="cross-site"||preferenceWrite&&headers.GetValueOrDefault("Origin")!=origin) { await Reply(stream,403,"text/plain",[],ct);return; }
            var route=request[1][(token.Length+2)..].Split('?')[0];
            if(route=="preferences"){
                if(preferences is null){await Reply(stream,503,"application/json",Encoding.UTF8.GetBytes("{}"),ct);return;}
                try{
                    if(!preferenceWrite){await Reply(stream,200,"application/json",JsonSerializer.SerializeToUtf8Bytes(preferences.Read()),ct);return;}
                    var lengthText=headers.GetValueOrDefault("Content-Length")??"";if(lengthText.Length==0||lengthText.Any(c=>!char.IsAsciiDigit(c))||!int.TryParse(lengthText,out var length)||length is <1 or >65536||!(headers.GetValueOrDefault("Content-Type")??"").StartsWith("application/json",StringComparison.OrdinalIgnoreCase)){await Reply(stream,400,"application/json",Encoding.UTF8.GetBytes("{}"),ct);return;}
                    var body=new byte[length];var offset=0;while(offset<length){var count=await stream.ReadAsync(body.AsMemory(offset),ct);if(count==0){await Reply(stream,400,"application/json",Encoding.UTF8.GetBytes("{}"),ct);return;}offset+=count;}
                    using var json=JsonDocument.Parse(body);if(json.RootElement.ValueKind!=JsonValueKind.Object||json.RootElement.EnumerateObject().Count()!=2||json.RootElement.EnumerateObject().Select(p=>p.Name).Distinct().Count()!=2||json.RootElement.EnumerateObject().Any(p=>p.Name is not ("revision" or "changes")))throw new ArgumentException("Invalid preference envelope");
                    var revision=json.RootElement.GetProperty("revision").GetString()??"";var changes=json.RootElement.GetProperty("changes").Deserialize<Dictionary<string,string?>>()??throw new ArgumentException("Missing preference changes");
                    await Reply(stream,200,"application/json",JsonSerializer.SerializeToUtf8Bytes(preferences.Patch(revision,changes)),ct);return;
                }catch(Meili.Core.Settings.DataConflictException){await Reply(stream,409,"application/json",Encoding.UTF8.GetBytes("{\"code\":\"VIEW_PREFERENCE_CONFLICT\"}"),ct);return;}
                catch(Exception ex)when(ex is ArgumentException or JsonException or InvalidOperationException or KeyNotFoundException){AppLog.Warn("qqq-gex","Rejected view preference: "+ex.GetType().Name);await Reply(stream,400,"application/json",Encoding.UTF8.GetBytes("{\"code\":\"INVALID_VIEW_PREFERENCE\"}"),ct);return;}
            }
            if(route=="events"){
                var url=new Uri(PageUri,request[1]);var after=url.Query.StartsWith("?after=",StringComparison.Ordinal)?Uri.UnescapeDataString(url.Query[7..]):"";var notification=Volatile.Read(ref changed);var version=cache?.RevisionToken()??"";
                if(version==after){try{await notification.Task.WaitAsync(TimeSpan.FromSeconds(5),ct);}catch(TimeoutException){}version=cache?.RevisionToken()??"";}
                await Reply(stream,200,"application/json",JsonSerializer.SerializeToUtf8Bytes(new {version,partial=cache?.LatestPartial(),quote=LocalQuote(),latestDate=version==after?null:cache?.LatestLocalDate(DateTimeOffset.UtcNow)}),ct);return;
            }
            if(route=="api/analysis/qqq/local-quote"){await Reply(stream,200,"application/json",JsonSerializer.SerializeToUtf8Bytes(new {quote=LocalQuote()}),ct);return;}
            if(route=="api/analysis/qqq/local-state"){await Reply(stream,200,"application/json",JsonSerializer.SerializeToUtf8Bytes(new {partial=cache?.LatestPartial(),latestDate=cache?.LatestLocalDate(DateTimeOffset.UtcNow),localOnly=true,revision=cache?.RevisionToken()??""}),ct);return;}
            if(route.StartsWith("api/",StringComparison.Ordinal)) {
                var path="/"+request[1][(token.Length+2)..];
                var cached=cache?.Read(snapshot,path,DateTimeOffset.UtcNow)??cache?.ReadLocalDay(path,DateTimeOffset.UtcNow)??cache?.ReadSpreadQuote(path,DateTimeOffset.UtcNow);
                if(cached is null&&directory is not null&&(path.StartsWith("/api/analysis/qqq/pcs/backtest?",StringComparison.Ordinal)||path.StartsWith("/api/analysis/qqq/pcs?",StringComparison.Ordinal)||path.StartsWith("/api/analysis/qqq/gex/intraday-context?",StringComparison.Ordinal)||path.StartsWith("/api/analysis/qqq/gex/exposure?",StringComparison.Ordinal)||path=="/api/analysis/qqq/pcs/local-decision")){
                    var result=await QqqGexCalculationRunner.QueryAsync(directory,path,ct);using var json=JsonSerializer.SerializeToDocument(result);
                    if(json.RootElement.TryGetProperty("body",out var wireBody)&&json.RootElement.TryGetProperty("contentType",out var wireType)){await Reply(stream,200,wireType.GetString()!,Encoding.UTF8.GetBytes(wireBody.GetString()!),ct);return;}
                    if((json.RootElement.TryGetProperty("available",out var available)&&available.ValueKind==JsonValueKind.True)||json.RootElement.TryGetProperty("intraday",out _)||json.RootElement.TryGetProperty("currentBars",out _)){await Reply(stream,200,"application/json",Encoding.UTF8.GetBytes(json.RootElement.GetRawText()),ct);return;}
                }
                if(cached is not null){await Reply(stream,200,cached.ContentType,Encoding.UTF8.GetBytes(cached.Body),ct);return;}
                await Reply(stream,503,"application/json",Encoding.UTF8.GetBytes("{\"error\":\"本地缓存中尚无该请求的数据\",\"code\":\"LOCAL_CACHE_MISS\",\"offline\":true}"),ct);return; }
            if(route.Contains('/') || route.Contains("..")) { await Reply(stream,404,"text/plain",[],ct);return; }
            using var asset=typeof(QqqGexSession).Assembly.GetManifestResourceStream("QqqGex/"+route);
            if(asset is null) { await Reply(stream,404,"text/plain",[],ct);return; }
            using var memory=new MemoryStream();await asset.CopyToAsync(memory,ct);
            await Reply(stream,200,route.EndsWith(".html",StringComparison.Ordinal)?"text/html; charset=utf-8":route.EndsWith(".css",StringComparison.Ordinal)?"text/css; charset=utf-8":"text/javascript; charset=utf-8",memory.ToArray(),ct);
        }
        catch(Exception ex) when(ex is IOException or OperationCanceledException or SocketException or ArgumentException) { AppLog.Warn("qqq-gex","Local viewer request ended: "+ex.GetType().Name); }
        finally { clients.Release(); }
    }
    private static async Task Reply(Stream s,int status,string type,byte[] body,CancellationToken ct)
    {
        var csp="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
        await s.WriteAsync(Encoding.ASCII.GetBytes($"HTTP/1.1 {status} Response\r\nContent-Type: {type}\r\nContent-Length: {body.Length}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: {csp}\r\nConnection: close\r\n\r\n"),ct);await s.WriteAsync(body,ct);
    }
    public void Dispose(){if(activity is not null)activity.Changed-=QuoteActivity;quotes?.Unsubscribe(quoteOwner);stop.Cancel();listener.Stop();}
}
