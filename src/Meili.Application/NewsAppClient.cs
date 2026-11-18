using System.Text.Json;
using Meili.Automation.Modules;
using Meili.Core.Abstractions;
using Meili.Core.Models;
namespace Meili.Shared.Services;

/// <summary>Reuses the native market router; no news browser, quote socket or extra provider owner.</summary>
public sealed class NewsAppClient(string directory,IMarketDataService market)
{
    private readonly ModuleFacadeClient facade=new(directory,ModuleAccess.NewsFundamentals);
    public Task<Fundamentals> FundamentalsAsync(string symbol,CancellationToken ct)=>facade.InvokeAsync("get_fundamentals",JsonSerializer.SerializeToElement(new{symbol}),token=>market.GetFundamentalsAsync(symbol,token),ct);
    public Task<FinancialStatements> FinancialsAsync(string symbol,CancellationToken ct)=>facade.InvokeAsync("get_financials",JsonSerializer.SerializeToElement(new{symbol}),token=>market.GetFinancialsAsync(symbol,token),ct);
    public Task<IReadOnlyList<NewsItem>> NewsAsync(string symbol,int limit,CancellationToken ct)=>facade.InvokeAsync("get_news",JsonSerializer.SerializeToElement(new{symbol,limit}),token=>market.GetNewsAsync(symbol,limit,token),ct);
}
