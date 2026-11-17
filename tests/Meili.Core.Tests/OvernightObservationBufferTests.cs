using Meili.Core.Models;
using Meili.Core.Quotes;
namespace Meili.Core.Tests;
public sealed class OvernightObservationBufferTests
{
    [Fact]public void Recent_source_detail_and_older_minute_samples_are_bounded_and_explicitly_clearable()
    {
        var start=new DateTimeOffset(2026,11,17,1,0,0,TimeSpan.Zero);var buffer=new OvernightObservationBuffer();
        for(var i=0;i<3600;i++)buffer.Add(new("QQQ",100+i*.001,start.AddSeconds(i),MarketState.Overnight,Source:"yahoo"),start.AddSeconds(i));
        var now=start.AddSeconds(3599);var points=buffer.Snapshot("QQQ",now);Assert.InRange(points.Count,300,1024);Assert.Equal(now,points[^1].Time);Assert.Equal(3599*.001+100,points[^1].Price);
        Assert.True(points.Zip(points.Skip(1)).All(p=>p.First.Time<p.Second.Time));Assert.True(points.Count(p=>p.Time>=now.AddMinutes(-4))>=240);
        buffer.Add(new("QQQ",1,start,MarketState.Unknown),now);Assert.Equal(points.Count,buffer.Snapshot("QQQ",now).Count);
        Assert.Equal(points.Count,buffer.Clear(true,now.AddHours(11)));Assert.Empty(buffer.Snapshot("QQQ",now.AddHours(11)));
    }
    [Fact]public void Evicts_oldest_symbols_at_the_shared_subscription_limit_without_growing_background_work()
    {
        var now=new DateTimeOffset(2026,11,17,1,0,0,TimeSpan.Zero);var buffer=new OvernightObservationBuffer();
        for(var i=0;i<=50;i++)buffer.Add(new("S"+i,100,now.AddSeconds(i),MarketState.Overnight),now.AddSeconds(i));
        Assert.Equal(50,buffer.Inspect(now.AddMinutes(1)).Count);Assert.Empty(buffer.Snapshot("S0",now.AddMinutes(1)));Assert.Single(buffer.Snapshot("S50",now.AddMinutes(1)));
    }
}
