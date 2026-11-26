using System.Text.Json;
using Meili.Automation.Modules;
using Meili.Core.Models;
namespace Meili.Shared.Services;

public sealed class LiquidityAppClient
{
    private readonly ModuleFacadeClient facade;
    private readonly MarketLiquidityService shared;
    public LiquidityAppClient(string directory,MarketLiquidityService shared)
    {facade=new(directory,ModuleAccess.MarketLiquidity);this.shared=shared;}
    internal LiquidityAppClient(string directory,MarketLiquidityService shared,ModuleInstaller installer,Func<CancellationToken,Task<string?>> runtime)
    {facade=new(directory,ModuleAccess.MarketLiquidity,installer,runtime);this.shared=shared;}
    public Task<LiquidityReport> LoadAsync(CancellationToken ct=default)=>facade.InvokeAsync("get_market_liquidity",JsonSerializer.SerializeToElement(new{}),shared.LoadAsync,ct);
}
