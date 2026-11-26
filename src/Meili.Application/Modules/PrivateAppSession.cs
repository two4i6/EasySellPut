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
    private readonly SemaphoreSlim clients=new(PrivateSessionShutdown.Capacity);
    private readonly Task acceptLoop;
    private readonly PrivateSessionShutdown shutdown=new();
    private readonly PrivateAppPresentation presentation=new();
    public void UpdatePresentation(JsonElement value)=>presentation.Update(value);
    private readonly string token=Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    private readonly string directory,id;
    private readonly PrivateAppOperations api;
    private readonly ModuleInstaller installer;
    private readonly IDisposable lease;
    private readonly HashSet<string> declaredAssets;
    private readonly HashSet<string> htmlPages;
    public Uri PageUri {get;}
    private PrivateAppSession(string directory,string id,string entry,bool writes,ModuleInstaller installer,IOperationDispatcher dispatcher,IDisposable lease,IEnumerable<string> assets)
    {
        this.directory=directory;this.id=id;this.installer=installer;this.lease=lease;api=new(directory,id,dispatcher,writes,installer);declaredAssets=assets.ToHashSet(StringComparer.Ordinal);htmlPages=declaredAssets.Where(a=>a.StartsWith("ui/",StringComparison.Ordinal)&&a.EndsWith(".html",StringComparison.Ordinal)).Select(a=>a[3..]).ToHashSet(StringComparer.Ordinal);
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
            if(await presentation.TryHandleAsync(route,request[0],request[1],headers,stream,deadline).ConfigureAwait(false))return;
            if(await api.TryHandleAsync(route,request[0],headers,stream,origin,deadline).ConfigureAwait(false))return;
            if(request[0]!="GET"||headers.ContainsKey("Content-Length")){await Send(403,"text/plain",[]);return;}
            var assetPath="ui/"+Uri.UnescapeDataString(route);ModulePackage.ValidatePath(assetPath);
            if(!declaredAssets.Contains(assetPath)){await Send(404,"text/plain",[]);return;}
            using var asset=await ModuleAssets.TryOpenAsync(directory,id,assetPath,installer,ct).ConfigureAwait(false);
            using var memory=new MemoryStream();using var data=asset!.OpenRead();await data.CopyToAsync(memory,ct).ConfigureAwait(false);
            await Send(200,PrivateHttp.AssetType(route),memory.ToArray());
        }
        catch(OperationCanceledException){} // expected: page detach cancels active requests.
        catch(Exception ex)when(ex is IOException or InvalidDataException or SocketException or ArgumentException or JsonException or InvalidOperationException or UnauthorizedAccessException)
        {Meili.Core.Diagnostics.AppLog.Warn("app-view","Private app request ended: "+ex.GetType().Name);}
        finally{clients.Release();}
    }
    public void Dispose()=>_ = BeginShutdown();
    public ValueTask DisposeAsync()=>new(BeginShutdown());
    private Task BeginShutdown()=>shutdown.Begin(()=>PrivateSessionShutdown.DrainAsync(acceptLoop,clients,stop,listener,lease));
}
