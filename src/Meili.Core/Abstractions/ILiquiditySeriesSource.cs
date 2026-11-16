using Meili.Core.Models;
namespace Meili.Core.Abstractions;
public interface ILiquiditySeriesSource
{
    Task<LiquiditySeries> GetSeriesAsync(string id, CancellationToken ct = default);
}
