using System.Runtime.CompilerServices;
using System.Threading.Channels;
using Meili.Core.Abstractions;
using Meili.Core.Models;
using Meili.Core.Quotes;
namespace Meili.Shared.Tests;

[Collection(nameof(UiPlatformCollection))]
public sealed class QuoteStreamPumpTests
{
    private sealed class Feed:IQuoteStreamSource
    {
        public int Calls,Active,Peak;
        public Channel<QuoteTick> Ticks=Channel.CreateUnbounded<QuoteTick>();
        public async IAsyncEnumerable<QuoteTick> WatchAsync(IReadOnlyList<string> symbols,[EnumeratorCancellation] CancellationToken ct=default)
        {
            Calls++;var active=Interlocked.Increment(ref Active);Peak=Math.Max(Peak,active);
            try{await foreach(var tick in Ticks.Reader.ReadAllAsync(ct))yield return tick;}
            finally{Interlocked.Decrement(ref Active);}
        }
    }
    private static async Task Wait(Func<bool> ready){using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(5));while(!ready())await Task.Delay(10,timeout.Token);}
    [Fact]public async Task Single_app_timer_coalesces_updates_and_last_subscriber_disconnects_without_network_leaks()
    {
        var ui=new FakeUiPlatform();Ui.Platform=ui;var hub=new QuoteHub(new PricingSnapshotTests.SnapshotData());var feed=new Feed();
        using var pump=new QuotePump(hub,stream:new QuoteStreamingService(feed));pump.Start();Assert.False(pump.IsPolling);Assert.Equal(0,feed.Calls);
        hub.Subscribe("first",["AAPL"]);await Wait(()=>feed.Active==1);hub.Subscribe("second",["AAPL"]);Assert.Equal(1,feed.Calls);
        var time=DateTimeOffset.UtcNow;
        await feed.Ticks.Writer.WriteAsync(new("AAPL",101,time,MarketState.Regular,Source:"fixture"));
        await feed.Ticks.Writer.WriteAsync(new("AAPL",102,time.AddMilliseconds(1),MarketState.Regular,Source:"fixture"));
        await Wait(()=>pump.CurrentInterval==TimeSpan.FromMilliseconds(250));await Task.Delay(30);
        ui.Timers.Single().Fire();Assert.True(hub.TryGetCached("AAPL",out var quote));Assert.Equal(102,quote.Price);
        hub.Unsubscribe("first");Assert.True(pump.IsPolling);hub.Unsubscribe("second");await Wait(()=>feed.Active==0);Assert.False(pump.IsPolling);Assert.Equal(1,feed.Peak);
    }
}
