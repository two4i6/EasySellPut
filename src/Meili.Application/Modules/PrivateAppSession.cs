using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Meili.Automation.Modules;

public interface IPrivateAppSession : IDisposable
{
    Uri PageUri {get;}
    bool IsPageUrl(string url);
}

/// <summary>Private signed UI origin with app-scoped typed operations. No remote-page bridge or arbitrary execution.</summary>
public sealed class PrivateAppSession : IPrivateAppSession, IAsyncDisposable
{
    private readonly TcpListener listener=new(IPAddress.Loopback,0);
    private readonly CancellationTokenSource stop=new();
    private readonly SemaphoreSlim clients=new(8);
    private readonly Task acceptLoop;
    private readonly object shutdownLock=new();
    private Task? shutdown;
    private readonly string token=Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    private readonly string directory,id;
    private readonly bool writes;
    private readonly ModuleInstaller installer;
    private readonly IOperationDispatcher dispatcher;
    private readonly IDisposable lease;
    private readonly HashSet<string> declaredAssets;
    private readonly HashSet<string> htmlPages;
    public Uri PageUri {get;}
    private PrivateAppSession(string directory,string id,string entry,bool writes,ModuleInstaller installer,IOperationDispatcher dispatcher,IDisposable lease,IEnumerable<string> assets)
    {
        this.directory=directory;this.id=id;this.writes=writes;this.installer=installer;this.dispatcher=dispatcher;this.lease=lease;declaredAssets=assets.ToHashSet(StringComparer.Ordinal);htmlPages=declaredAssets.Where(a=>a.StartsWith("ui/",StringComparison.Ordinal)&&a.EndsWith(".html",StringComparison.Ordinal)).Select(a=>a[3..]).ToHashSet(StringComparer.Ordinal);
        listener.Start();PageUri=new($"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}/{token}/{entry}");
        acceptLoop=Task.Run(Accept);
    }
    public static Task<PrivateAppSession> CreateAsync(string directory,string id,IOperationDispatcher dispatcher,bool allowWrites=false,CancellationToken ct=default)=>
        CreateAsync(directory,id,dispatcher,allowWrites,new ModuleInstaller(directory),ct);
    internal static async Task<PrivateAppSession> CreateAsync(string directory,string id,IOperationDispatcher dispatcher,bool allowWrites,ModuleInstaller installer,CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        if(!string.Equals(Path.GetFullPath(directory),Path.GetFullPath(dispatcher.DirectoryInfo.Path),OperatingSystem.IsWindows()?StringComparison.OrdinalIgnoreCase:StringComparison.Ordinal))throw new ArgumentException("AppView and dispatcher profiles must match.");
        var lease=ModuleAccess.AcquireEnabled(directory,id);
        try
        {
            var package=await installer.VerifyInstalledAsync(id,ct).ConfigureAwait(false);
            var ui=package.Manifest.Ui??throw new InvalidOperationException("Application core is installed without a UI.");
            return new(directory,id,ui[3..],allowWrites,installer,dispatcher,lease,package.Manifest.Files.Select(f=>f.Path));
        }
        catch{lease.Dispose();throw;}
    }
    public bool IsPageUrl(string url)=>Uri.TryCreate(url,UriKind.Absolute,out var parsed)&&parsed.GetLeftPart(UriPartial.Authority)==PageUri.GetLeftPart(UriPartial.Authority)&&parsed.AbsolutePath.StartsWith("/"+token+"/",StringComparison.Ordinal)&&htmlPages.Contains(Uri.UnescapeDataString(parsed.AbsolutePath[(token.Length+2)..]));
    private async Task Accept()
    {
        try
        {
            while(!stop.IsCancellationRequested)
            {
                await clients.WaitAsync(stop.Token).ConfigureAwait(false);
                try{var socket=await listener.AcceptTcpClientAsync(stop.Token).ConfigureAwait(false);_=Handle(socket);}
                catch{clients.Release();throw;}
            }
        }
        catch(OperationCanceledException){}catch(SocketException)when(stop.IsCancellationRequested){}
    }
    private async Task Handle(TcpClient socket)
    {
        using(socket)using(var deadline=CancellationTokenSource.CreateLinkedTokenSource(stop.Token))
        try
        {
            deadline.CancelAfter(TimeSpan.FromSeconds(10));var ct=deadline.Token;using var stream=socket.GetStream();
            var (request,headers,complete)=await PrivateHttp.ReadHeadAsync(stream,ct).ConfigureAwait(false);
            Task Send(int status,string type,byte[] body)=>PrivateHttp.ReplyAsync(stream,status,type,body,ct);
            var origin=PageUri.GetLeftPart(UriPartial.Authority);
            if(!complete||request.Length!=3||request[2]!="HTTP/1.1"||request[0]is not("GET" or "POST")||headers.GetValueOrDefault("Host")!=PageUri.Authority||
                !request[1].StartsWith('/'+token+'/',StringComparison.Ordinal)||headers.ContainsKey("Transfer-Encoding")||
                headers.TryGetValue("Origin",out var sent)&&sent!=origin||headers.GetValueOrDefault("Sec-Fetch-Site")=="cross-site")
            {await Send(403,"text/plain",[]);return;}
            var route=request[1][(token.Length+2)..].Split('?')[0];
            if(route=="host/catalog"&&request[0]=="GET"&&!headers.ContainsKey("Content-Length"))
            {
                var operations=await ModuleOperations.ReadAsync(directory,installer,ct).ConfigureAwait(false);
                await Send(200,"application/json",JsonSerializer.SerializeToUtf8Bytes(new{appId=id,allowWrites=writes,operations=operations.Where(o=>o.AppId==id&&(writes||!o.Definition.Writes)).Select(o=>new{o.Definition.Name,o.Definition.Description,o.Definition.Writes,inputSchema=o.Definition.Schema})},WireJson.Options));return;
            }
            if(route=="host/invoke"&&request[0]=="POST")
            {
                if(headers.GetValueOrDefault("Origin")!=origin||!headers.GetValueOrDefault("Content-Type","").StartsWith("application/json",StringComparison.OrdinalIgnoreCase)||
                    !int.TryParse(headers.GetValueOrDefault("Content-Length"),out var length)||length is <1 or >1048576)
                {await Send(403,"application/json",[]);return;}
                var body=new byte[length];var offset=0;
                while(offset<length){var read=await stream.ReadAsync(body.AsMemory(offset),ct).ConfigureAwait(false);if(read==0)return;offset+=read;}
                using var input=JsonDocument.Parse(body,new JsonDocumentOptions{MaxDepth=16});ModulePackage.RejectDuplicates(input.RootElement);
                if(input.RootElement.ValueKind!=JsonValueKind.Object||input.RootElement.EnumerateObject().Count()!=2||!input.RootElement.TryGetProperty("operation",out var op)||op.ValueKind!=JsonValueKind.String||!input.RootElement.TryGetProperty("arguments",out var arguments))
                {await Send(400,"application/json",[]);return;}
                var bound=(await ModuleOperations.ReadAsync(directory,installer,ct).ConfigureAwait(false)).SingleOrDefault(o=>o.AppId==id&&o.Definition.Name==op.GetString());
                if(bound is null||bound.Definition.Writes&&!writes){await Send(403,"application/json",[]);return;}
                try
                {
                OperationCatalog.Validate(new(bound.Definition.Name,bound.Definition.Description,bound.Definition.Writes,bound.Definition.Schema),arguments);
                deadline.CancelAfter(TimeSpan.FromMinutes(2));
                var result=await dispatcher.ExecuteAsync(bound.Definition.Name,arguments,writes,ct).ConfigureAwait(false);
                await Send(200,"application/json",JsonSerializer.SerializeToUtf8Bytes(result));return;
                }
                catch(Exception ex)when(ex is ArgumentException or JsonException or InvalidOperationException or UnauthorizedAccessException or IOException)
                {await Send(ex is UnauthorizedAccessException?403:ex is ArgumentException or JsonException?400:503,"application/json",JsonSerializer.SerializeToUtf8Bytes(WireJson.Error(ex),WireJson.Options));return;}
            }
            if(request[0]!="GET"||headers.ContainsKey("Content-Length")){await Send(403,"text/plain",[]);return;}
            var assetPath="ui/"+Uri.UnescapeDataString(route);ModulePackage.ValidatePath(assetPath);
            if(!declaredAssets.Contains(assetPath)){await Send(404,"text/plain",[]);return;}
            using var asset=await ModuleAssets.TryOpenAsync(directory,id,assetPath,installer,ct).ConfigureAwait(false);
            using var memory=new MemoryStream();using var data=asset!.OpenRead();await data.CopyToAsync(memory,ct).ConfigureAwait(false);
            await Send(200,PrivateHttp.AssetType(route),memory.ToArray());
        }
        catch(Exception ex)when(ex is IOException or OperationCanceledException or SocketException or ArgumentException or JsonException or InvalidOperationException or UnauthorizedAccessException)
        {Meili.Core.Diagnostics.AppLog.Warn("app-view","Private app request ended: "+ex.GetType().Name);}
        finally{clients.Release();}
    }
    public void Dispose()=>_ = BeginShutdown();
    public ValueTask DisposeAsync()=>new(BeginShutdown());
    private Task BeginShutdown()
    {
        lock(shutdownLock)return shutdown??=ShutdownAsync();
    }
    private async Task ShutdownAsync()
    {
        stop.Cancel();listener.Stop();
        try
        {
            await acceptLoop.ConfigureAwait(false);
            // Drain accepted requests before releasing the app execution lease. Navigation disposal
            // stays nonblocking, while the separate developer host can await scratch-file cleanup.
            for(var i=0;i<8;i++)await clients.WaitAsync().ConfigureAwait(false);
        }
        finally{lease.Dispose();clients.Dispose();stop.Dispose();}
    }
}
