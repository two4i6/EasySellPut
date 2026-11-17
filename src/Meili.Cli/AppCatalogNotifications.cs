using System.Security.Cryptography;
using System.Text.Json;
using System.Threading.Channels;
using Meili.Automation;
using Meili.Core.Diagnostics;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace Meili.Cli;

/// <summary>One bounded filesystem observer per transport. No polling, market work or execution lease.</summary>
internal sealed class AppCatalogNotifications : IAsyncDisposable
{
    private readonly FileSystemWatcher watcher;
    private readonly Channel<bool> changes=Channel.CreateBounded<bool>(new BoundedChannelOptions(1){FullMode=BoundedChannelFullMode.DropWrite,SingleReader=true});
    private readonly CancellationTokenSource stop;
    private readonly Task worker;
    private readonly object subscriptionsLock=new();
    private readonly HashSet<Channel<bool>> subscriptions=[];
    private readonly string registry;
    private AppCatalogNotifications(IOperationDispatcher dispatcher,McpServer server,bool writes,CancellationToken ct)
    {
        stop=CancellationTokenSource.CreateLinkedTokenSource(ct);
        registry=Path.GetFullPath(Path.Combine(dispatcher.DirectoryInfo.Path,"apps","registry.json"));
        var root=dispatcher.DirectoryInfo.Path;
        while(!Directory.Exists(root))root=Path.GetDirectoryName(root)??throw new IOException("No existing app profile ancestor.");
        watcher=new(root){IncludeSubdirectories=true,NotifyFilter=NotifyFilters.FileName|NotifyFilters.DirectoryName|NotifyFilters.LastWrite|NotifyFilters.Size};
        watcher.Changed+=Changed;watcher.Created+=Changed;watcher.Deleted+=Changed;watcher.Renamed+=Renamed;
        watcher.Error+=(_,e)=>{AppLog.Warn("mcp","App catalog watcher overflow; rechecking catalog",e.GetException());changes.Writer.TryWrite(true);};
        watcher.EnableRaisingEvents=true;
        worker=Observe(dispatcher,server,writes);
    }
    public static AppCatalogNotifications Start(IOperationDispatcher dispatcher,McpServer server,bool writes,CancellationToken ct)=>new(dispatcher,server,writes,ct);
    private bool Matches(string path)=>string.Equals(Path.GetFullPath(path),registry,OperatingSystem.IsWindows()?StringComparison.OrdinalIgnoreCase:StringComparison.Ordinal);
    private void Changed(object sender,FileSystemEventArgs e){if(Matches(e.FullPath))changes.Writer.TryWrite(true);}
    private void Renamed(object sender,RenamedEventArgs e){if(Matches(e.FullPath)||Matches(e.OldFullPath))changes.Writer.TryWrite(true);}
    private async Task Observe(IOperationDispatcher dispatcher,McpServer server,bool writes)
    {
        string? fingerprint=null;
        async Task Check(bool notify)
        {
            IOperationCatalog catalog;
            for(var attempt=0;;attempt++)
            {
                try{catalog=await dispatcher.GetCatalogAsync(stop.Token).ConfigureAwait(false);break;}
                catch(IOException)when(attempt<5)
                {
                    // Registry publication precedes maintenance-lease release. Windows can
                    // deliver every replacement event before authenticated discovery is ready.
                    // Retry this event, bounded and cancellable; never accept unverified metadata.
                    await Task.Delay(TimeSpan.FromMilliseconds(100*(1<<attempt)),stop.Token).ConfigureAwait(false);
                }
            }
            var next=Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(catalog.All.Where(o=>writes||!o.Writes).Select(o=>new{o.Name,o.Description,o.Writes,o.Schema}),WireJson.Options)));
            var changed=fingerprint is not null&&fingerprint!=next;fingerprint=next;
            if(notify&&changed)
            {
                if(server.NegotiatedProtocolVersion is ("2024-11-05" or "2025-03-26" or "2025-06-18" or "2025-11-25"))
                    await server.SendNotificationAsync(NotificationMethods.ToolListChangedNotification,stop.Token).ConfigureAwait(false);
                else lock(subscriptionsLock)foreach(var subscription in subscriptions)subscription.Writer.TryWrite(true);
            }
        }
        try
        {
            await Check(false).ConfigureAwait(false);
            await foreach(var _ in changes.Reader.ReadAllAsync(stop.Token).ConfigureAwait(false))
                try{await Check(true).ConfigureAwait(false);}
                catch(Exception ex)when(ex is IOException or InvalidDataException or UnauthorizedAccessException or JsonException or ArgumentException)
                {AppLog.Warn("mcp","App catalog change could not be authenticated; next request will revalidate",ex);}
        }
        catch(OperationCanceledException)when(stop.IsCancellationRequested){}
        catch(Exception ex){AppLog.Warn("mcp","App catalog notifications stopped; explicit discovery remains available",ex);}
    }
    public async ValueTask<EmptyResult> ListenAsync(RequestContext<SubscriptionsListenRequestParams> request,CancellationToken ct)
    {
        using var linked=CancellationTokenSource.CreateLinkedTokenSource(ct,stop.Token);
        var channel=Channel.CreateBounded<bool>(new BoundedChannelOptions(1){FullMode=BoundedChannelFullMode.DropWrite,SingleReader=true});
        var tools=request.Params?.Notifications?.ToolsListChanged==true;
        lock(subscriptionsLock)
        {
            if(subscriptions.Count>=8)throw new ArgumentException("Too many catalog subscriptions.");
            subscriptions.Add(channel);
        }
        var meta=new Dictionary<string,JsonElement>{{"io.modelcontextprotocol/subscriptionId",JsonSerializer.SerializeToElement(request.JsonRpcRequest.Id)}};
        try
        {
            await request.Server.SendNotificationAsync(NotificationMethods.SubscriptionsAcknowledgedNotification,new{notifications=new{toolsListChanged=tools},_meta=meta},WireJson.Options,linked.Token).ConfigureAwait(false);
            await foreach(var _ in channel.Reader.ReadAllAsync(linked.Token).ConfigureAwait(false))
                if(tools)await request.Server.SendNotificationAsync(NotificationMethods.ToolListChangedNotification,new{_meta=meta},WireJson.Options,linked.Token).ConfigureAwait(false);
        }
        catch(OperationCanceledException)when(linked.IsCancellationRequested){}
        finally{lock(subscriptionsLock)subscriptions.Remove(channel);channel.Writer.TryComplete();}
        return new EmptyResult();
    }
    public async ValueTask DisposeAsync()
    {
        watcher.Dispose();stop.Cancel();changes.Writer.TryComplete();await worker.ConfigureAwait(false);stop.Dispose();
    }
}
