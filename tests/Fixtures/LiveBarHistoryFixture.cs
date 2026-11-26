using Meili.Core.Models;
namespace Meili.Testing;
public static class LiveBarHistoryFixture
{
    public static BarSeries Series(BarRequest r)
    {
        var time=new DateTimeOffset(2026,11,16,15,28,0,TimeSpan.Zero);
        return new(){Symbol=r.Symbol,Interval=r.Interval,Source="fixture",Adjustment=PriceAdjustment.Split,AsOf=time.AddMinutes(2).AddSeconds(-1),FetchedAt=time.AddMinutes(2),Bars=[new(time,100,101,99,100,1000),new(time.AddMinutes(1),100,101,99,100,1000)]};
    }
}
