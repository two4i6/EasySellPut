using System.Runtime.CompilerServices;
using Meili.Core.Abstractions;
using Meili.Core.Models;
namespace Meili.Testing;

/// <summary>Test-host-only stream: finite reproducible regular and extended ticks, then idle until cancelled.</summary>
public sealed class QuoteStreamFixture : IQuoteStreamSource
{
    public string SourceId=>"fixture";
    public async IAsyncEnumerable<QuoteTick> WatchAsync(IReadOnlyList<string> symbols,[EnumeratorCancellation] CancellationToken ct=default)
    {
        foreach(var symbol in symbols){ct.ThrowIfCancellationRequested();yield return new(symbol,101,new(2026,11,16,15,30,0,TimeSpan.Zero),MarketState.Regular,1,1,1000,"USD","NMS","Fixture", "fixture");}
        await Task.Delay(Timeout.Infinite,ct);
    }
}
