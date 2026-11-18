using System.Text.Json;
using Meili.Automation;
using Meili.Automation.Modules;
using Meili.Core.Models;

namespace Meili.Shared.Services;

/// <summary>Native presentation uses the same authenticated report operation as CLI/MCP, sharing its existing providers.</summary>
public sealed class LiquidityAppClient
{
    private readonly string directory;
    private readonly MarketLiquidityService shared;
    private readonly ModuleInstaller installer;
    private readonly Func<CancellationToken,Task<string?>> runtime;
    public LiquidityAppClient(string directory,MarketLiquidityService shared)
        :this(directory,shared,new ModuleInstaller(directory),ct=>PinnedNodeRuntime.ExtractNodeAsync(directory,ct)) { }
    internal LiquidityAppClient(string directory,MarketLiquidityService shared,ModuleInstaller installer,Func<CancellationToken,Task<string?>> runtime)
    {this.directory=directory;this.shared=shared;this.installer=installer;this.runtime=runtime;}

    public async Task<LiquidityReport> LoadAsync(CancellationToken ct=default)
    {
        var discovery=await ModuleOperations.ReadSnapshotAsync(directory,installer,ct).ConfigureAwait(false);
        discovery.RequireAvailable(ModuleAccess.MarketLiquidity);
        var app=discovery.State?.Apps.SingleOrDefault(app=>app.Id==ModuleAccess.MarketLiquidity);
        if(app is {Enabled:false} || (discovery.State?.SuppressedSeeds??[]).Contains(ModuleAccess.MarketLiquidity))
            throw new AppUnavailableException(ModuleAccess.MarketLiquidity);
        var operation=discovery.Operations.SingleOrDefault(operation=>operation.AppId==ModuleAccess.MarketLiquidity && operation.Definition.Name=="get_market_liquidity");
        if(operation is null)
        {
            if(app is not null)throw new AppUnavailableException(ModuleAccess.MarketLiquidity);
            using var lease=ModuleAccess.AcquireEnabled(directory,ModuleAccess.MarketLiquidity);
            return await shared.LoadAsync(ct).ConfigureAwait(false);
        }
        async Task<JsonElement> Host(string name,JsonElement args,CancellationToken token)
        {
            if(name!="get_market_liquidity")throw new UnauthorizedAccessException("Liquidity presentation only grants its report capability.");
            OperationCatalog.Validate(OperationCatalog.Find(name),args);
            return WireJson.Element(WireJson.Success(await shared.LoadAsync(token).ConfigureAwait(false)));
        }
        var result=await ModuleProcess.ExecuteAsync(directory,operation,JsonSerializer.SerializeToElement(new{}),false,installer,runtime,ct,Host).ConfigureAwait(false);
        return WireJson.Read<LiquidityReport>(result);
    }
}
