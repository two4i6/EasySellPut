using Meili.Core.Abstractions;
using Meili.Core.Models;
namespace Meili.Shared.Tests;
public sealed class SymbolSearchCacheTests
{
    private sealed class Market : IMarketDataService
    {
        public int Calls; public TaskCompletionSource<IReadOnlyList<SymbolMatch>>? Gate;
        public Task<IReadOnlyList<SymbolMatch>> SearchAsync(string query, int limit = 10, CancellationToken ct = default)
        { Calls++; return Gate?.Task ?? Task.FromResult<IReadOnlyList<SymbolMatch>>([]); }
        public Task<IReadOnlyList<Quote>> GetQuotesAsync(IReadOnlyList<string> symbols, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<BarSeries> GetBarsAsync(BarRequest request, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<DateOnly>> GetExpirationsAsync(string symbol, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<OptionChain> GetChainAsync(string symbol, DateOnly? expiration = null, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Fundamentals> GetFundamentalsAsync(string symbol, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<FinancialStatements> GetFinancialsAsync(string symbol, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<NewsItem>> GetNewsAsync(string symbol, int count = 20, CancellationToken ct = default) => throw new NotSupportedException();
    }
    [Fact] public async Task Case_insensitive_queries_share_results_and_clearing_does_not_restore_an_inflight_answer()
    {
        var market = new Market { Gate = new(TaskCreationOptions.RunContinuationsAsynchronously) }; var search = new SymbolSearchService(market);
        var first = search.SearchAsync("aapl"); var second = search.SearchAsync(" AAPL "); Assert.Equal(1, market.Calls);
        search.Clear(false); market.Gate.SetResult([]); await Task.WhenAll(first, second); Assert.Equal(0, search.Inspect().Entries);
        market.Gate = null; await search.SearchAsync("aapl"); await search.SearchAsync("AAPL"); Assert.Equal(2, market.Calls);
        Assert.Equal(1, search.Inspect().Entries);
    }
}
