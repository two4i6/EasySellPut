using System.Text.Json;
using Meili.Automation;
using Meili.Automation.Modules;
using Meili.Core.Abstractions;
using Meili.Core.Models;
namespace Meili.Shared.Services;
/// <summary>Domain lifecycle + shared native receipts; explicit saved-state writes use the authenticated app operation.</summary>
public sealed class OptionsStrategyAppClient(string directory,IMarketDataService market,PricingAssumptions pricing,StrategyStore store)
{
    private readonly ModuleFacadeClient facade=new(directory,ModuleAccess.OptionsStrategy);
    public Task<IDisposable> AcquireAsync(CancellationToken ct)=>facade.AcquireDomainAsync(ct);
    public Task<OptionChain> ChainAsync(string symbol,DateOnly? expiry,CancellationToken ct)=>facade.WithHostSnapshotAsync("get_option_chain",token=>market.GetChainAsync(symbol,expiry,token),ct);
    public Task<PricingInputs> PricingAsync(string symbol,string area,CancellationToken ct)=>facade.WithHostSnapshotAsync("get_pricing_assumptions",token=>pricing.ForAsync(symbol,area,token),ct);
    public Task<SavedStrategy> SaveAsync(SavedStrategy saved,CancellationToken ct=default)
    {
        var args=WireJson.Element(new{name=saved.Name,symbol=saved.Symbol,kind=saved.Kind.ToString(),legs=saved.Legs.Select(l=>new{type=l.Type.ToString(),side=l.Side.ToString(),quantity=l.Quantity,strike=l.Strike,premium=l.Premium,expiry=l.Expiry?.ToString("yyyy-MM-dd"),iv=l.Iv,multiplier=l.Multiplier}).ToArray()});
        // Optional schema fields are omitted, not encoded as invalid nulls (stock expiry and missing IV).
        var node=System.Text.Json.Nodes.JsonNode.Parse(args.GetRawText())!;
        foreach(var leg in node["legs"]!.AsArray())foreach(var key in new[]{"expiry","iv"})if(leg![key] is null)leg.AsObject().Remove(key);
        args=JsonSerializer.SerializeToElement(node);
        return facade.InvokeWriteAsync("save_strategy",args,token=>{token.ThrowIfCancellationRequested();store.Save(saved);return Task.FromResult(saved);},ct);
    }
    public async Task DeleteAsync(string name,CancellationToken ct=default)=>await facade.InvokeWriteAsync("delete_strategy",WireJson.Element(new{name}),token=>{token.ThrowIfCancellationRequested();store.Delete(name);return Task.FromResult(WireJson.Element(new{deleted=name}));},ct);
}
