using Meili.Core.Abstractions;
using Meili.Core.Models;
using Meili.Shared.Services;
using Meili.Testing;
using System.Runtime.CompilerServices;
namespace Meili.Automation.Tests;

public sealed class QuoteStreamingTests
{
    [Fact]public async Task Bounded_sample_is_actual_stream_data_and_retains_sessions_and_missing_symbols()
    {
        var sample=await new QuoteStreamingService(new QuoteStreamFixture()).SampleAsync(["AAPL","MSFT"],1,1);
        Assert.Equal("fixture",sample.Source);Assert.Equal("websocket",sample.Transport);Assert.Equal("received",sample.Status);Assert.Equal(101,Assert.Single(sample.Ticks).Price);Assert.Equal(["MSFT"],sample.MissingSymbols);Assert.Equal(MarketState.Regular,sample.Ticks[0].Session);
    }
    private sealed class Idle:IQuoteStreamSource
    {
        public bool Disposed;
        public async IAsyncEnumerable<QuoteTick> WatchAsync(IReadOnlyList<string> symbols,[EnumeratorCancellation]CancellationToken ct=default)
        {try{await Task.Delay(Timeout.Infinite,ct);}finally{Disposed=true;}yield break;}
    }
    [Fact]public async Task Quiet_session_is_not_fabricated_as_zero_or_connection_failure_and_deadline_disconnects()
    {
        var source=new Idle();var result=await new QuoteStreamingService(source).SampleAsync(["AAPL"],1);
        Assert.Equal("no_updates",result.Status);Assert.Empty(result.Ticks);Assert.Equal(["AAPL"],result.MissingSymbols);Assert.True(source.Disposed);
        using var stop=new CancellationTokenSource();stop.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>new QuoteStreamingService(source).SampleAsync(["AAPL"],1,ct:stop.Token));
    }
    private sealed class BreakOnce:IQuoteStreamSource
    {
        public int Calls;
        public async IAsyncEnumerable<QuoteTick> WatchAsync(IReadOnlyList<string> symbols,[EnumeratorCancellation]CancellationToken ct=default)
        {
            if(++Calls==1)throw new IOException("disconnect");
            await Task.Yield();yield return new("AAPL",102,DateTimeOffset.UtcNow,MarketState.Regular,Source:"fixture");
        }
    }
    [Fact]public async Task Disconnected_session_resubscribes_with_bounded_backoff_and_returns_observed_updates()
    {
        var source=new BreakOnce();var result=await new QuoteStreamingService(source).SampleAsync(["AAPL"],4,1);
        Assert.Single(result.Interruptions!);Assert.Equal(2,source.Calls);Assert.Equal(102,Assert.Single(result.Ticks).Price);Assert.Equal("received",result.Status);
    }
}
