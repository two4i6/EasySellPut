using System.Runtime.CompilerServices;
using Meili.Core.Abstractions;
using Meili.Core.Diagnostics;
using Meili.Core.Models;
namespace Meili.Shared.Services;

/// <summary>Reusable bounded-input stream session. No alert monitor, disk writes, UI or claimed exchange entitlement.</summary>
public sealed class QuoteStreamingService(IQuoteStreamSource source)
{
    public async IAsyncEnumerable<QuoteTick> WatchAsync(IReadOnlyList<string> symbols,Action<string>? onError=null,[EnumeratorCancellation] CancellationToken ct=default)
    {
        if(symbols.Count is <1 or >50)throw new ArgumentException("Streaming supports 1..50 symbols.");
        var failures=0;
        while(true)
        {
            ct.ThrowIfCancellationRequested();
            await using(var reader=source.WatchAsync(symbols,ct).GetAsyncEnumerator(ct))
            {
                while(true)
                {
                    bool more;
                    try{more=await reader.MoveNextAsync().ConfigureAwait(false);}
                    catch(OperationCanceledException)when(ct.IsCancellationRequested){throw;}
                    catch(Exception ex){var error=ex.GetType().Name;AppLog.Warn("quote-stream","Quote stream interrupted",ex);onError?.Invoke(error);break;}
                    if(!more){onError?.Invoke("Source stream ended.");break;}
                    var tick=reader.Current;
                    if(!symbols.Contains(tick.Symbol,StringComparer.OrdinalIgnoreCase)||!double.IsFinite(tick.Price)||tick.Price<=0||tick.Time>DateTimeOffset.UtcNow.AddMinutes(1))continue;
                    failures=0;yield return tick;
                }
            }
            failures=Math.Min(failures+1,5);
            await Task.Delay(TimeSpan.FromMilliseconds(Math.Min(30000,500*(1<<failures))+Random.Shared.Next(0,250)),ct).ConfigureAwait(false);
        }
    }
    public async Task<LiveQuoteSample> SampleAsync(IReadOnlyList<string> symbols,int seconds=5,int maxUpdates=100,CancellationToken ct=default)
    {
        if(seconds is <1 or >20||maxUpdates is <1 or >500)throw new ArgumentException("Use 1..20 seconds and 1..500 updates.");
        using var deadline=CancellationTokenSource.CreateLinkedTokenSource(ct);deadline.CancelAfter(TimeSpan.FromSeconds(seconds));
        List<QuoteTick> ticks=[];List<StreamInterruption> interruptions=[];string? error=null;
        try{await foreach(var tick in WatchAsync(symbols,e=>{error=e;if(interruptions.Count<20)interruptions.Add(new(DateTimeOffset.UtcNow,e));},deadline.Token).ConfigureAwait(false)){ticks.Add(tick);if(ticks.Count==maxUpdates)break;}}
        catch(OperationCanceledException)when(!ct.IsCancellationRequested&&deadline.IsCancellationRequested){}
        ct.ThrowIfCancellationRequested();
        return new("websocket",source.SourceId,ticks,symbols.Where(s=>!ticks.Any(t=>t.Symbol.Equals(s,StringComparison.OrdinalIgnoreCase))).ToArray(),ticks.Count>0?"received":error is null?"no_updates":"unavailable",error,source.Coverage,interruptions);
    }
}
