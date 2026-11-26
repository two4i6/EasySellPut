using System.Text.Json;
namespace Meili.Automation.Modules;

/// <summary>The same app-scoped HTTP API for generic AppView and compatibility documents.</summary>
public sealed class PrivateAppOperations
{
    private readonly string directory,id;
    private readonly IOperationDispatcher dispatcher;
    private readonly bool writes;
    private readonly ModuleInstaller installer;
    public event EventHandler? Written;
    public string DirectoryPath=>directory;
    public string AppId=>id;
    public PrivateAppOperations(string directory,string id,IOperationDispatcher dispatcher,bool allowWrites=false):this(directory,id,dispatcher,allowWrites,new ModuleInstaller(directory)){}
    internal PrivateAppOperations(string directory,string id,IOperationDispatcher dispatcher,bool allowWrites,ModuleInstaller installer)
    {
        ModuleRegistry.ValidateId(id);
        if(!string.Equals(Path.TrimEndingDirectorySeparator(Path.GetFullPath(directory)),Path.TrimEndingDirectorySeparator(Path.GetFullPath(dispatcher.DirectoryInfo.Path)),OperatingSystem.IsWindows()?StringComparison.OrdinalIgnoreCase:StringComparison.Ordinal))throw new ArgumentException("Private app and dispatcher profiles must match.");
        this.directory=directory;this.id=id;this.dispatcher=dispatcher;writes=allowWrites;this.installer=installer;
    }
    public async Task<bool> TryHandleAsync(string route,string method,IReadOnlyDictionary<string,string> headers,Stream stream,string origin,CancellationTokenSource deadline)
    {
        if(route is not("host/catalog" or "host/invoke"))return false;
        var ct=deadline.Token;
        Task Send(int status,string type,byte[] body)=>PrivateHttp.ReplyAsync(stream,status,type,body,ct);
        try
        {
            if(route=="host/catalog"&&method=="GET"&&!headers.ContainsKey("Content-Length"))
            {
                var discovery=await ModuleOperations.ReadSnapshotAsync(directory,installer,ct).ConfigureAwait(false);var operations=discovery.Operations;
                await Send(200,"application/json",JsonSerializer.SerializeToUtf8Bytes(new{appId=id,allowWrites=writes,unavailableApps=discovery.Issues.Where(issue=>issue.AppId is null||issue.AppId==id),operations=operations.Where(o=>o.AppId==id&&(writes||!o.Definition.Writes)).Select(o=>new{o.Definition.Name,o.Definition.Description,o.Definition.Writes,inputSchema=o.Definition.Schema})},WireJson.Options));return true;
            }
            if(route=="host/invoke"&&method=="POST")
            {
                if(headers.GetValueOrDefault("Origin")!=origin||!headers.GetValueOrDefault("Content-Type","").StartsWith("application/json",StringComparison.OrdinalIgnoreCase)||
                    !int.TryParse(headers.GetValueOrDefault("Content-Length"),out var length)||length is <1 or >1048576)
                {await Send(403,"application/json",[]);return true;}
                var body=new byte[length];var offset=0;
                while(offset<length){var read=await stream.ReadAsync(body.AsMemory(offset),ct).ConfigureAwait(false);if(read==0)return true;offset+=read;}
                using var input=JsonDocument.Parse(body,new JsonDocumentOptions{MaxDepth=16});
                try{ModulePackage.RejectDuplicates(input.RootElement);}catch(InvalidDataException){throw new ArgumentException("Duplicate app invocation field.");}
                if(input.RootElement.ValueKind!=JsonValueKind.Object||input.RootElement.EnumerateObject().Count()!=2||!input.RootElement.TryGetProperty("operation",out var op)||op.ValueKind!=JsonValueKind.String||!input.RootElement.TryGetProperty("arguments",out var arguments))
                {await Send(400,"application/json",[]);return true;}
                var available=await ModuleOperations.ReadSnapshotAsync(directory,installer,ct).ConfigureAwait(false);available.RequireAvailable(id);
                var bound=available.Operations.SingleOrDefault(o=>o.AppId==id&&o.Definition.Name==op.GetString());
                if(bound is null||bound.Definition.Writes&&!writes){await Send(403,"application/json",[]);return true;}
                OperationCatalog.Validate(new(bound.Definition.Name,bound.Definition.Description,bound.Definition.Writes,bound.Definition.Schema),arguments);
                deadline.CancelAfter(TimeSpan.FromMinutes(2));
                var result=await dispatcher.ExecuteAsync(bound.Definition.Name,arguments,writes,ct).ConfigureAwait(false);
                if(bound.Definition.Writes&&result.ValueKind==JsonValueKind.Object&&result.TryGetProperty("success",out var success)&&success.ValueKind==JsonValueKind.True)foreach(EventHandler handler in Written?.GetInvocationList()??[])
                    try{handler(this,EventArgs.Empty);}catch(Exception ex){Meili.Core.Diagnostics.AppLog.Warn("app-view","App write committed; presentation notification failed",ex);}
                await Send(200,"application/json",JsonSerializer.SerializeToUtf8Bytes(result));return true;

            }
            await Send(403,"application/json",[]);return true;
        }
        catch(Exception ex)when(ex is ArgumentException or JsonException or InvalidOperationException or UnauthorizedAccessException or IOException or InvalidDataException)
        {
            // expected: HTTP callers receive bounded public errors; financial arguments are not logged.
            await Send(ex is UnauthorizedAccessException?403:ex is ArgumentException or JsonException?400:503,"application/json",JsonSerializer.SerializeToUtf8Bytes(WireJson.Error(ex),WireJson.Options));return true;
        }
    }
}
