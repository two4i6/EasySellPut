using Meili.Core.Abstractions;
using Meili.Core.Models;
namespace Meili.Shared.Services;

public sealed class LiveBarsService(IMarketDataService market,QuoteStreamingService stream,TimeProvider? clock=null)
{
    public async Task<LiveBarsSample> SampleAsync(string symbol,BarInterval interval,int seconds=5,int maxUpdates=100,CancellationToken ct=default)
    {
        var now=(clock??TimeProvider.System).GetUtcNow();
        var request=new BarRequest(symbol,interval,interval.IsIntraday()?now.AddHours(-6):now.AddYears(-2));
        var join=new LiveBarStitcher();using(var fetch=CancellationTokenSource.CreateLinkedTokenSource(ct)){fetch.CancelAfter(TimeSpan.FromSeconds(15));join.SetHistory(await market.GetBarsAsync(request,fetch.Token).ConfigureAwait(false));}
        var sample=await stream.SampleAsync([symbol],seconds,maxUpdates,ct).ConfigureAwait(false);
        foreach(var tick in sample.Ticks)join.Observe(tick);
        // Refresh an overlapping provider tail before joining: no missing minute is filled from a last price.
        using(var fetch=CancellationTokenSource.CreateLinkedTokenSource(ct)){fetch.CancelAfter(TimeSpan.FromSeconds(15));join.SetHistory(await market.GetBarsAsync(request,fetch.Token).ConfigureAwait(false));}
        return new(join.View((clock??TimeProvider.System).GetUtcNow()),sample);
    }
}
