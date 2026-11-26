using Meili.Core.Models;
using Meili.Core.Time;
namespace Meili.Shared.Tests;
public sealed class QuotePriceViewTests
{
    private static DateTimeOffset At(int day,int hour,int minute=0)=>MarketClock.FromEastern(new DateTime(2026,11,day,hour,minute,0));
    private static Quote Regular => new(){Symbol="QQQ",Price=100,PreviousClose=95,Change=5,ChangePercent=5.26,AsOf=At(13,16),FetchedAt=At(16,8),DelayMinutes=0,MarketState=MarketState.PreMarket};
    [Fact] public void Premarket_uses_its_own_price_time_and_close_basis_without_mutating_regular_data()
    {
        var original=Regular with{ExtendedPrice=98,ExtendedTime=At(16,7,59)};
        var view=QuotePriceView.Select(original,At(16,8));
        Assert.True(view.IsExtended); Assert.Equal(MarketSession.PreMarket,view.Session);Assert.Equal(98,view.Snapshot.Price);
        Assert.Equal(-2,view.Snapshot.Change);Assert.Equal(-2,view.Snapshot.ChangePercent);Assert.Equal(At(16,7,59),view.Snapshot.AsOf);
        Assert.False(view.Stale(At(16,8)));Assert.Equal(100,original.Price);Assert.Equal(5,original.Change);
    }
    [Fact] public void Latest_postmarket_remains_available_when_closed_and_is_not_mislabelled_as_next_days_premarket()
    {
        var quote=Regular with{ExtendedPrice=102,ExtendedTime=At(13,19,55)};
        var view=QuotePriceView.Select(quote,At(16,8));
        Assert.True(view.IsExtended);Assert.Equal(MarketSession.AfterHours,view.Session);Assert.True(view.Stale(At(16,8)));
        Assert.Equal(102,QuotePriceView.Select(quote with{MarketState=MarketState.Closed},At(14,12)).Snapshot.Price);
    }
    [Fact] public void Missing_unknown_future_and_older_extended_quotes_cannot_replace_the_primary_price()
    {
        var now=At(16,8);
        foreach(var q in new[]{Regular with{ExtendedPrice=98},Regular with{ExtendedPrice=double.NaN,ExtendedTime=At(16,7)},Regular with{ExtendedPrice=98,ExtendedTime=At(16,9)},Regular with{ExtendedPrice=98,ExtendedTime=At(13,15)},Regular with{MarketState=MarketState.Regular,ExtendedPrice=98,ExtendedTime=At(16,7)}})
            Assert.False(QuotePriceView.Select(q,now).IsExtended);
    }
    [Fact] public void Extended_source_movement_wins_and_non_finite_values_fall_back_without_infinity()
    {
        var q=Regular with{ExtendedPrice=99,ExtendedTime=At(16,7),ExtendedChange=-1.1,ExtendedChangePercent=-1.11};
        Assert.Equal(-1.11,QuotePriceView.Select(q,At(16,8)).Snapshot.ChangePercent);
        Assert.Equal(-1,QuotePriceView.Select(q with{ExtendedChange=double.NaN,ExtendedChangePercent=double.PositiveInfinity},At(16,8)).Snapshot.ChangePercent);
    }
}
