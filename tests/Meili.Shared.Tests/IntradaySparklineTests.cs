using Meili.Core.Settings;
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

    [Fact]
    public void Auto_uses_latest_session_and_explicit_views_keep_their_own_axis_and_reference()
    {
        var series = new BarSeries
        {
            Symbol = "SPY",
            Interval = BarInterval.Minute5,
            Bars =
            [
                B(At(13, 4), 97), B(At(13, 4, 5), 98),
                B(At(13, 9, 30), 99), B(At(13, 9, 35), 100),
                B(At(13, 16), 101), B(At(13, 16, 20), 102)
            ]
        };
        var quote = new Quote { Symbol = "SPY", Price = 100, PreviousClose = 96, AsOf = At(13, 16) };
        var now = At(13, 17);

        var post = IntradaySparkline.ForQuote(series, quote, now);
        Assert.Equal(MarketSession.AfterHours, post.Session);
        Assert.Equal(new[] { "16:00", "18:00", "20:00" }, post.AxisLabels);
        Assert.NotNull(post.Baseline);
        Assert.True(post.Points[1].Break);
        Assert.Equal(0, post.Points[0].X);

        var pre = IntradaySparkline.ForQuote(series, quote, now, IntradayView.PreMarket);
        Assert.Equal(MarketSession.PreMarket, pre.Session);
        Assert.Equal("04:00", pre.AxisLabels[0]);
        Assert.NotNull(pre.Baseline);
        var cached = IntradaySparkline.ForQuote(series, quote with { AsOf = At(14, 16) }, now);
        Assert.Null(cached.Baseline);
        Assert.Equal(MarketSession.Regular, IntradaySparkline.ForQuote(series, quote, At(13, 15)).Session);
    }

    [Fact]
    public void Moving_averages_share_the_price_scale_and_restart_after_a_gap_in_extended_hours()
    {
        var series = new BarSeries
        {
            Symbol = "SPY",
            Interval = BarInterval.Minute5,
            Bars =
            [
                B(At(13, 15, 55), 200),
                B(At(13, 16), 100), B(At(13, 16, 5), 102), B(At(13, 16, 10), 104), B(At(13, 16, 15), 112),
                B(At(13, 17), 112), B(At(13, 17, 5), 110), B(At(13, 17, 10), 108),
                B(At(13, 18), 110), B(At(13, 18, 5), 112)
            ]
        };
        var graph = IntradaySparkline.ForQuote(series, null, At(13, 19), IntradayView.AfterHours,
            new SparklineSettings(ShowMa: true, MaPeriod: 2, ShowEma: true, EmaPeriod: 2));
        Assert.Equal(MarketSession.AfterHours, graph.Session);
        Assert.Equal(5, graph.Ma.Count);
        Assert.Equal(graph.Ma.Select(point => point.X), graph.Ema.Select(point => point.X));
        Assert.Equal(graph.Points[1].X, graph.Ma[0].X);
        Assert.Equal((graph.Points[0].Y + graph.Points[1].Y) / 2, graph.Ma[0].Y, 10);
        Assert.Equal((graph.Points[2].Y + graph.Points[3].Y) / 2, graph.Ma[2].Y, 10);
        Assert.NotEqual(graph.Ma[2].Y, graph.Ema[2].Y);
        Assert.Equal(new[] { true, false, false, true, false }, graph.Ma.Select(point => point.Break));
        Assert.Equal(graph.Ma.Select(point => point.Break), graph.Ema.Select(point => point.Break));

        var withoutEma = IntradaySparkline.ForQuote(series, null, At(13, 19), IntradayView.AfterHours,
            new SparklineSettings(ShowMa: true, MaPeriod: 20, ShowEma: false));
        Assert.Empty(withoutEma.Ma);
        Assert.Empty(withoutEma.Ema);
        Assert.Equal(graph.Points, withoutEma.Points);
    }

    [Fact]
    public void Session_state_uses_only_selected_session_prices_and_compares_completed_volume_at_the_same_time()
    {
        static Bar Ohlcv(DateTimeOffset time, double price, double volume) => new(time, price, price + 2, price - 2, price, volume);
        var history = new[] { 9, 10, 11, 12 }.SelectMany(day => new[]
        {
            Ohlcv(At(day, 9, 30), 90, 10000),
            Ohlcv(At(day, 16), 100, 100),
            Ohlcv(At(day, 16, 5), 104, 100),
            Ohlcv(At(day, 16, 10), 108, 10000)
        });
        var bars = history.Concat(new[]
        {
            Ohlcv(At(13, 15, 55), 999, 5000),
            Ohlcv(At(13, 16), 100, 100), Ohlcv(At(13, 16, 5), 110, 300),
            Ohlcv(At(13, 16, 10), 108, 10000),
            Ohlcv(At(13, 16, 15), 999, 1000)
        }).ToArray();
        var series = new BarSeries { Symbol = "SPY", Interval = BarInterval.Minute5, Bars = bars };
        var now = At(13, 16, 12);
        var settings = new SparklineSettings(ShowVwap: true);
        var graph = IntradaySparkline.ForQuote(series, null, now, IntradayView.AfterHours, settings);
        Assert.Equal(MarketSession.AfterHours, graph.Session);
        Assert.Equal(2, graph.RelativeVolume);
        Assert.Equal(10d / 14, graph.RangePosition!.Value, 8);
        Assert.Equal(graph.Points.Select(point => point.X), graph.Vwap.Select(point => point.X));
        Assert.Equal(graph.Points[0].Y, graph.Vwap[0].Y);
        Assert.Equal(108 / ((100d * 100 + 110 * 300 + 108 * 10000) / 10400) - 1,
            graph.VwapDistance!.Value, 8);
        Assert.Empty(IntradaySparkline.ForQuote(series, null, now).Vwap);

        var missingHistory = bars.Where(bar => bar.Time != At(9, 16, 5) && bar.Time != At(10, 16, 5)).ToArray();
        Assert.Null(IntradaySparkline.ForQuote(series with { Bars = missingHistory }, null, now).RelativeVolume);

        var missingCurrent = bars.Select(bar => bar.Time == At(13, 16, 5)
            ? Bar.CloseOnly(bar.Time, bar.Close, 0) : bar).ToArray();
        var incomplete = IntradaySparkline.ForQuote(series with { Bars = missingCurrent }, null, now, IntradayView.AfterHours, settings);
        Assert.Null(incomplete.RelativeVolume);
        Assert.Null(incomplete.RangePosition);
        Assert.True(incomplete.Vwap[^1].Break);
    }
}
