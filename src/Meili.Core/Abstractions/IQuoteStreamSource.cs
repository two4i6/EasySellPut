using Meili.Core.Models;
namespace Meili.Core.Abstractions;

public interface IQuoteStreamSource
{
    string SourceId => "unknown";
    string Coverage => "Last-price updates; inspect source timing and coverage. No tick is not proof of disconnection or zero price.";
    IAsyncEnumerable<QuoteTick> WatchAsync(IReadOnlyList<string> symbols, CancellationToken ct = default);
}
