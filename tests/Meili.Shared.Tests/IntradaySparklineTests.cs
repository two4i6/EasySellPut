using Meili.Core.Models;
using Meili.Core.Time;
namespace Meili.Shared.Tests;
public sealed class IntradaySparklineTests
{
    private static DateTimeOffset At(int day,int hour,int minute=0)=>MarketClock.FromEastern(new DateTime(2026,11,day,hour,minute,0));
    private static Bar B(DateTimeOffset t,double p)=>Bar.CloseOnly(t,p,1);
    [Fact] public void Uses_the_actual_latest_regular_trading_day_and_does_not_extend_into_the_future()
    {
        var series=new BarSeries{Symbol="AAPL",Interval=BarInterval.Minute5,Bars=[B(At(12,15),90),B(At(13,8),95),B(At(13,9,30),100),B(At(13,9,35),102),B(At(13,17),110),B(At(16,10),120)]};
        var graph=IntradaySparkline.Create(series,99,At(15,12));Assert.Equal(new DateOnly(2026,11,13),graph.Day);Assert.Equal(2,graph.Points.Count);Assert.Equal(0,graph.Points[0].X);Assert.InRange(graph.Points[^1].X,0.01,0.02);Assert.NotNull(graph.Baseline);
    }
    [Fact] public void Missing_intervals_stay_gaps_flat_prices_stay_centered_and_daily_bars_are_not_intraday()
    {
        var series=new BarSeries{Symbol="AAPL",Interval=BarInterval.Minute5,Bars=[B(At(13,9,30),100),B(At(13,9,35),double.NaN),B(At(13,10),100)]};var graph=IntradaySparkline.Create(series,null,At(15,12));Assert.All(graph.Points,p=>{Assert.Equal(.5,p.Y);Assert.True(p.Break);});Assert.Null(graph.Baseline);Assert.Empty(IntradaySparkline.Create(series with{Interval=BarInterval.Day1},null,At(15,12)).Points);
    }
    [Fact] public void Extended_sessions_use_their_own_days_axes_and_actual_gaps()
    {
        var series=new BarSeries{Symbol="QQQ",Interval=BarInterval.Minute5,Bars=[B(At(13,19),101),B(At(13,19,5),102),B(At(16,4),98),B(At(16,4,5),99),B(At(16,9,30),100),B(At(16,16),102),B(At(16,16,5),103),B(At(16,20),999)]};
        var pre=IntradaySparkline.Create(series,100,At(16,8),MarketSession.PreMarket);
        Assert.Equal(new DateOnly(2026,11,16),pre.Day);Assert.Equal(2,pre.Points.Count);Assert.Equal("04:00",pre.StartLabel);Assert.Equal("06:45",pre.MiddleLabel);Assert.Equal("09:30",pre.EndLabel);Assert.Equal(0,pre.Points[0].X);
        var post=IntradaySparkline.Create(series,100,At(16,20),MarketSession.AfterHours);
        Assert.Equal(2,post.Points.Count);Assert.Equal("16:00",post.StartLabel);Assert.Equal("20:00",post.EndLabel);Assert.Equal(At(16,16,5),post.AsOf);
    }
    [Fact] public void Overnight_joins_midnight_into_one_session_without_reusing_postmarket_or_other_nights()
    {
        var series=new BarSeries{Symbol="QQQ",Interval=BarInterval.Minute5,Source="fixture",Bars=[B(At(13,23),50),B(At(16,19,55),80),B(At(16,20),100),B(At(16,23,55),101),B(At(17,0),102),B(At(17,0,5),103),B(At(17,4),999)]};
        var night=IntradaySparkline.Create(series,99,At(17,4),MarketSession.Overnight);
        Assert.Equal(new DateOnly(2026,11,16),night.Day);Assert.Equal(4,night.Points.Count);
        Assert.Equal("20:00",night.StartLabel);Assert.Equal("00:00",night.MiddleLabel);Assert.Equal("04:00",night.EndLabel);
        Assert.Equal(0,night.Points[0].X);Assert.Equal(.5,night.Points[2].X);Assert.True(night.Points[1].Break);
        Assert.Empty(IntradaySparkline.Create(series with{Bars=[B(At(16,16),100),B(At(16,19,55),101)]},100,At(17,2),MarketSession.Overnight).Points);
        Assert.Empty(IntradaySparkline.Create(series,100,At(17,2),MarketSession.Closed).Points);
    }
    [Theory][InlineData(true)][InlineData(false)]
    public void Glance_big_and_mini_graph_use_the_shared_observed_tail_in_extended_sessions(bool pre)
    {
        var now=At(16,pre?8:18);var session=pre?MarketSession.PreMarket:MarketSession.AfterHours;
        var row=new Meili.Shared.ViewModels.PanelQuoteRow("QQQ"){Now=()=>now,Quote=new(){Symbol="QQQ",Price=100,PreviousClose=99,Source="yahoo",AsOf=At(pre?13:16,16),MarketState=pre?MarketState.PreMarket:MarketState.AfterHours,ExtendedTime=now,ExtendedPrice=102,ExtendedDelivery="websocket",ExtendedSource="yahoo"}};
        row.SetGraphs(new(){Symbol="QQQ",Interval=BarInterval.Minute5,Source="yahoo",FetchedAt=now.AddSeconds(-1),Bars=[B(now.AddMinutes(-10),100),B(now.AddMinutes(-5),101)]},now);
        Assert.Equal(session,row.Graph.Session);Assert.Equal(3,row.Graph.Points.Count);Assert.Equal(now,row.Graph.AsOf);Assert.True(row.ChartObserved);Assert.False(row.ChartRepairing);Assert.Equal("UpBrush",row.GraphBrushKey);
        var current=row.Graph;row.ChartSession=MarketSession.Overnight;Assert.Empty(row.Graph.Points);Assert.Equal(MarketSession.Overnight,row.Graph.Session);
        row.ChartSession=null;Assert.Equal(current,row.Graph);
    }
    [Fact] public void Overnight_quote_label_uses_source_time_and_session_day_instead_of_calling_it_postmarket()
    {
        var at=At(17,1);var quote=new Quote{Symbol="QQQ",Price=100,AsOf=At(16,16),MarketState=MarketState.AfterHours,ExtendedTime=at,ExtendedPrice=101};
        var view=QuotePriceView.Select(quote,at);Assert.Equal(MarketSession.Overnight,view.Session);Assert.Equal("Quote_Overnight",view.SessionKey);
        Assert.Equal(new DateOnly(2026,11,16),IntradaySparkline.SessionDay(at,view.Session));
    }
    [Fact] public void First_real_price_is_a_single_dot_not_an_invented_flat_line()
    {
        var at=At(16,4);var graph=IntradaySparkline.Create(new(){Symbol="QQQ",Interval=BarInterval.Minute5,Bars=[B(at,100)]},99,at,MarketSession.PreMarket);
        Assert.Single(graph.Points);Assert.True(graph.Points[0].Break);Assert.Equal(0,graph.Points[0].X);
    }
    [Fact] public void A_single_missing_source_bucket_is_a_break_not_a_fabricated_bridge()
    {
        var at=At(16,16);var graph=IntradaySparkline.Create(new(){Symbol="QQQ",Interval=BarInterval.Minute5,Bars=[B(at,100),B(at.AddMinutes(10),101)]},99,at.AddMinutes(10),MarketSession.AfterHours);
        Assert.Equal(2,graph.Points.Count);Assert.True(graph.Points[1].Break);
    }
    [Fact] public void Received_only_overnight_segment_fits_actual_observation_times_and_survives_historical_refresh()
    {
        var first=At(17,2).AddSeconds(10);var now=first;
        var quote=new Quote{Symbol="QQQ",Price=100,AsOf=At(16,16),Source="yahoo",MarketState=MarketState.Overnight,ExtendedPrice=101,ExtendedTime=first,ExtendedSource="yahoo",ExtendedDelivery="websocket"};
        var row=new Meili.Shared.ViewModels.PanelQuoteRow("QQQ"){Now=()=>now,Quote=quote};var history=new BarSeries{Symbol="QQQ",Interval=BarInterval.Minute5,Source="yahoo",Bars=[B(At(16,19,55),100)]};
        var buffer=new Meili.Core.Quotes.OvernightObservationBuffer();buffer.Add(new("QQQ",101,first,MarketState.Overnight,Source:"yahoo"),now);
        row.SetGraphs(history,now);row.SetNightObservations(buffer.Snapshot("QQQ",now),now);Assert.Single(row.Graph.Points);Assert.Equal("—",row.Graph.StartLabel);Assert.NotNull(row.Graph.WindowStart);
        now=first.AddMinutes(1);row.Quote=quote with{ExtendedPrice=102,ExtendedTime=now};row.ObserveLive(now);buffer.Add(new("QQQ",102,now,MarketState.Overnight,Source:"yahoo"),now);row.SetNightObservations(buffer.Snapshot("QQQ",now),now);
        Assert.Equal(2,row.Graph.Points.Count);Assert.Equal(0,row.Graph.Points[0].X);Assert.Equal(1,row.Graph.Points[^1].X);Assert.False(row.ChartRepairing);Assert.Equal("02:00:10",row.Graph.StartLabel);Assert.Equal("02:01:10",row.Graph.EndLabel);
        row.SetGraphs(history,now);row.SetNightObservations(buffer.Snapshot("QQQ",now),now);Assert.Equal(2,row.Graph.Points.Count);Assert.Equal(first,row.Graph.WindowStart);
    }
    [Fact] public void Partial_overnight_gaps_have_explicit_guides_without_adding_or_moving_observations()
    {
        var first=At(17,20,21);var last=At(18,2,6);
        var series=new BarSeries{Symbol="QQQ",Interval=BarInterval.Minute1,Source="fixture",Bars=[B(first,660),B(first.AddMinutes(1),661),B(At(17,21,20),660.5),B(At(17,21,21),661.5),B(last,662)]};
        var graph=IntradaySparkline.Create(series,657,last,MarketSession.Overnight,fitObserved:true);
        Assert.Equal(5,graph.Points.Count);Assert.Equal(first,graph.WindowStart);Assert.Equal(last,graph.WindowEnd);
        Assert.Equal(0,graph.Points[0].X);Assert.Equal(1,graph.Points[^1].X);
        Assert.Equal(59d/345,graph.Points[2].X,10);
        Assert.False(graph.Points[1].Break);Assert.True(graph.Points[2].Break);Assert.True(graph.Points[2].GapGuide);
        Assert.True(graph.Points[4].GapGuide);Assert.True(graph.HasGapGuides);
        var fixedAxis=IntradaySparkline.Create(series,657,last,MarketSession.Overnight);
        Assert.False(fixedAxis.HasGapGuides);Assert.True(fixedAxis.Points[2].Break);
    }
    [Fact] public void Explicit_invalid_samples_remain_unbridged_even_in_received_only_windows()
    {
        var at=At(17,22);
        var graph=IntradaySparkline.Create(new(){Symbol="QQQ",Interval=BarInterval.Minute1,Bars=[B(at,660),B(at.AddMinutes(1),double.NaN),B(at.AddMinutes(20),661)]},null,at.AddHours(1),MarketSession.Overnight,fitObserved:true);
        Assert.Equal(2,graph.Points.Count);Assert.All(graph.Points,p=>Assert.True(p.Break));Assert.False(graph.HasGapGuides);
    }
    [Fact] public void Received_tick_gap_uses_elapsed_time_not_calendar_minute_boundaries()
    {
        var at=At(17,22).AddSeconds(59);
        var graph=IntradaySparkline.Create(new(){Symbol="QQQ",Interval=BarInterval.Minute1,Bars=[B(at,660),B(at.AddSeconds(61),661),B(at.AddSeconds(181),662)]},null,at.AddHours(1),MarketSession.Overnight,fitObserved:true);
        Assert.False(graph.Points[1].Break);Assert.False(graph.Points[1].GapGuide);
        Assert.True(graph.Points[2].Break);Assert.True(graph.Points[2].GapGuide);
    }
    [Fact] public void Tooltip_selects_actual_samples_and_never_bridges_missing_or_future_intervals()
    {
        var first=new Bar(At(13,9,30),100,103,99,102,20);
        var second=Bar.CloseOnly(At(13,10),105,1);
        var graph=IntradaySparkline.Create(new BarSeries{Symbol="AAPL",Interval=BarInterval.Minute5,Bars=[first,second]},null,At(13,12));
        Assert.Same(first,graph.HitTest(0)!.Bar);
        Assert.Same(second,graph.HitTest(30d/390)!.Bar);
        Assert.Null(graph.HitTest(15d/390));Assert.Null(graph.HitTest(1));
        Assert.Null(graph.HitTest(double.NaN));Assert.Null(graph.HitTest(-.01));
        Assert.Null(graph.HitTest(3d/390));
        var loc=new LocalizationService();loc.Apply("en-US");
        var tooltip=IntradaySparkline.Tooltip(graph.Points[0],loc);
        Assert.Contains("2026-11-13 09:30:00 ET",tooltip);Assert.Contains("Open  100",tooltip);
        Assert.Contains("High  103",tooltip);Assert.Contains("Low  99",tooltip);Assert.Contains("Close  102",tooltip);
        var closeOnly=IntradaySparkline.Tooltip(graph.Points[1],loc);
        Assert.DoesNotContain("Open",closeOnly);Assert.Contains("Close  105",closeOnly);
        var partial=graph.Points[0] with{Bar=first with{Low=double.NaN,Incomplete=true}};
        Assert.Contains("Low  —",IntradaySparkline.Tooltip(partial,loc));
        loc.Apply("zh-CN");Assert.Contains("收盘",IntradaySparkline.Tooltip(graph.Points[1],loc));
    }
    [Fact] public void Tooltip_respects_premarket_and_received_only_overnight_axes_including_gap_guides()
    {
        var pre=IntradaySparkline.Create(new BarSeries{Symbol="QQQ",Interval=BarInterval.Minute5,Bars=[B(At(13,4),100),B(At(13,5),102)]},null,At(13,6),MarketSession.PreMarket);
        Assert.Equal("04:00",pre.StartLabel);Assert.Equal(At(13,5),pre.HitTest(60d/330)!.Bar!.Time);
        Assert.Null(pre.HitTest(30d/330));
        var overnight=IntradaySparkline.Create(new BarSeries{Symbol="QQQ",Interval=BarInterval.Minute1,Bars=[B(At(13,23,50),100),B(At(14,0,10),102)]},null,At(14,1),MarketSession.Overnight,true);
        Assert.True(overnight.HasGapGuides);Assert.Equal(At(13,23,50),overnight.HitTest(0)!.Bar!.Time);
        Assert.Equal(At(14,0,10),overnight.HitTest(1)!.Bar!.Time);Assert.Null(overnight.HitTest(.5));
        var loc=new LocalizationService();Assert.StartsWith("2026-11-14 00:10:00 ET",IntradaySparkline.Tooltip(overnight.Points[^1],loc));
        var one=IntradaySparkline.Create(new BarSeries{Symbol="QQQ",Interval=BarInterval.Minute1,Bars=[B(At(14,0,10),102)]},null,At(14,1),MarketSession.Overnight,true);
        Assert.NotNull(one.HitTest(.5));Assert.Null(one.HitTest(0));
    }
}
