using System.Text.Json;
using Meili.Automation;
using Meili.Automation.Modules;
using Meili.Core.Models;

namespace Meili.Automation.Modules;

/// <summary>Native presentation uses the same authenticated report operation as CLI/MCP, sharing its existing providers.</summary>
public sealed class ModuleFacadeClient
{
    private readonly string directory;
    private readonly string appId;
    private readonly ModuleInstaller installer;
    private readonly Func<CancellationToken,Task<string?>> runtime;
    public ModuleFacadeClient(string directory,string appId)
        :this(directory,appId,new ModuleInstaller(directory),ct=>PinnedNodeRuntime.ExtractNodeAsync(directory,ct)) { }
    internal ModuleFacadeClient(string directory,string appId,ModuleInstaller installer,Func<CancellationToken,Task<string?>> runtime)
    {this.directory=directory;this.appId=appId;this.installer=installer;this.runtime=runtime;}

    public Task<T> InvokeAsync<T>(string name,JsonElement arguments,Func<CancellationToken,Task<T>> load,CancellationToken ct=default)=>InvokeCoreAsync(name,arguments,load,false,ct);
    internal Task<T> InvokeWriteAsync<T>(string name,JsonElement arguments,Func<CancellationToken,Task<T>> load,CancellationToken ct=default)=>InvokeCoreAsync(name,arguments,load,true,ct);
    private async Task<T> InvokeCoreAsync<T>(string name,JsonElement arguments,Func<CancellationToken,Task<T>> load,bool allowWrites,CancellationToken ct)
    {
        if(ModuleAccess.OperationOwner(name)!=appId)throw new UnauthorizedAccessException("Foreign native facade operation.");
        var definition=OperationCatalog.Find(name);
        OperationCatalog.Validate(definition,arguments);
        if(definition.Writes && (!allowWrites || appId is not (ModuleAccess.OptionsStrategy or ModuleAccess.Charts)))throw new UnauthorizedAccessException("Explicit native write authorization required.");
        var discovery=await ModuleOperations.ReadSnapshotAsync(directory,installer,ct).ConfigureAwait(false);
        discovery.RequireAvailable(appId);
        var app=discovery.State?.Apps.SingleOrDefault(app=>app.Id==appId);
        if(app is {Enabled:false} || (discovery.State?.SuppressedSeeds??[]).Contains(appId))
            throw new AppUnavailableException(appId);
        var operation=discovery.Operations.SingleOrDefault(operation=>operation.AppId==appId && operation.Definition.Name==name);
        if(operation is null)
        {
            if(app is not null)throw new AppUnavailableException(appId);
            using var lease=ModuleAccess.AcquireEnabled(directory,appId);
            return await load(ct).ConfigureAwait(false);
        }
        var writes=0;var applied=false;
        async Task<JsonElement> Host(string hostName,JsonElement args,CancellationToken token)
        {
            if(hostName!=name || !JsonElement.DeepEquals(args,arguments))throw new UnauthorizedAccessException("Native presentation only grants the requested operation and exact arguments.");
            if(definition.Writes && Interlocked.Exchange(ref writes,1)!=0)throw new UnauthorizedAccessException("Native write grant already consumed.");
            OperationCatalog.Validate(OperationCatalog.Find(hostName),args);
            var data=await load(token).ConfigureAwait(false);applied=true;return WireJson.Element(WireJson.Success(data));
        }
        var result=await ModuleProcess.ExecuteAsync(directory,operation,arguments,allowWrites,installer,runtime,ct,Host).ConfigureAwait(false);
        if(definition.Writes&&!applied)throw new InvalidDataException("App returned success without the native mutation.");
        return WireJson.Read<T>(result);
    }
    /// <summary>Full native provider receipts and synchronous Analytics stay host-owned, under verified domain availability and a lease.</summary>
    internal async Task<T> WithHostSnapshotAsync<T>(string operation,Func<CancellationToken,Task<T>> load,CancellationToken ct)
    {
        if(ModuleAccess.OperationOwner(operation)!=appId || OperationCatalog.Find(operation).Writes)throw new UnauthorizedAccessException();
        using var lease=await AcquireDomainAsync(ct).ConfigureAwait(false);
        return await load(ct).ConfigureAwait(false);
    }

    internal async Task<IDisposable> AcquireDomainAsync(CancellationToken ct)
    {
        var lease=ModuleAccess.AcquireEnabled(directory,appId);
        try
        {
            var discovery=await ModuleOperations.ReadSnapshotAsync(directory,installer,ct).ConfigureAwait(false);
            discovery.RequireAvailable(appId);
            return lease;
        }
        catch{lease.Dispose();throw;}
    }

}
