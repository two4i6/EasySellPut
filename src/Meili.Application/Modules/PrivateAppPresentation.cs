using System.Text.Json;
namespace Meili.Automation.Modules;
/// <summary>Read-only live presentation shared by all private app documents; no preferences, market polling or transport bridge.</summary>
public sealed class PrivateAppPresentation
{
    private readonly object presentationLock=new();
    private JsonElement presentation=JsonSerializer.SerializeToElement<object?>(null);
    private long presentationVersion;
    private TaskCompletionSource presentationChanged=new(TaskCreationOptions.RunContinuationsAsynchronously);
    public void Update(JsonElement value)
    {
        if(JsonSerializer.SerializeToUtf8Bytes(value).Length>65536)throw new ArgumentException("App presentation exceeds bound.");
        lock(presentationLock)
        {
            if(JsonElement.DeepEquals(presentation,value))return;
            presentation=value.Clone();presentationVersion++;
            var previous=presentationChanged;presentationChanged=new(TaskCreationOptions.RunContinuationsAsynchronously);previous.TrySetResult();
        }
    }
    public async Task<bool> TryHandleAsync(string route,string method,string target,IReadOnlyDictionary<string,string> headers,Stream stream,CancellationTokenSource deadline)
    {
        if(route!="host/presentation")return false;
        var ct=deadline.Token;Task Send(int status,string type,byte[] body)=>PrivateHttp.ReplyAsync(stream,status,type,body,ct);
            if(method=="GET"&&!headers.ContainsKey("Content-Length"))
            {
                var question=target.IndexOf('?');var query=question<0?"":target[question..];
                Task? changed=null;
                if(query.Length>0)
                {
                    if(!query.StartsWith("?version=",StringComparison.Ordinal)||!long.TryParse(query[9..],out var version)||version< -1)
                    {await Send(400,"application/json",[]);return true;}
                    lock(presentationLock)if(version==presentationVersion)changed=presentationChanged.Task;
                }
                if(changed is not null)
                {
                    deadline.CancelAfter(TimeSpan.FromSeconds(25));
                    try{await changed.WaitAsync(TimeSpan.FromSeconds(20),ct).ConfigureAwait(false);}catch(TimeoutException){}
                }
                object snapshot;lock(presentationLock)snapshot=new{version=presentationVersion,value=presentation};
                await Send(200,"application/json",JsonSerializer.SerializeToUtf8Bytes(snapshot,WireJson.Options));return true;
            }
        await Send(403,"application/json",[]);return true;
    }
}
