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

    public async Task<T> InvokeAsync<T>(string name,JsonElement arguments,Func<CancellationToken,Task<T>> load,CancellationToken ct=default)
    {
        if(ModuleAccess.OperationOwner(name)!=appId)throw new UnauthorizedAccessException("Foreign native facade operation.");
        OperationCatalog.Validate(OperationCatalog.Find(name),arguments);
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
        async Task<JsonElement> Host(string hostName,JsonElement args,CancellationToken token)
        {
            if(hostName!=name || !JsonElement.DeepEquals(args,arguments))throw new UnauthorizedAccessException("Native presentation only grants the requested operation and exact arguments.");
            OperationCatalog.Validate(OperationCatalog.Find(hostName),args);
            return WireJson.Element(WireJson.Success(await load(token).ConfigureAwait(false)));
        }
        var result=await ModuleProcess.ExecuteAsync(directory,operation,arguments,false,installer,runtime,ct,Host).ConfigureAwait(false);
        return WireJson.Read<T>(result);
    }
}
