using System.Runtime.InteropServices;
using Meili.Analytics;
using Meili.Core.Abstractions;
using Meili.Core.Models;
using Meili.Core.Settings;
using Meili.Core.Time;

namespace Meili.Shared.Services;

public enum IntradayView { Automatic, Regular, PreMarket, AfterHours }

public sealed record SparkPoint(double X,double Y,bool Break=false, bool GapGuide=false)
{
    public Bar? Bar { get; init; }
}
public sealed record IntradaySparkline(IReadOnlyList<SparkPoint> Points,DateOnly? Day,double? Baseline,string Source,bool Offline, MarketSession Session = MarketSession.Regular, DateTimeOffset? AsOf = null, DateTimeOffset? WindowStart = null, DateTimeOffset? WindowEnd = null)
{
    public IReadOnlyList<SparkPoint> Ma { get; init; } = [];
    public IReadOnlyList<SparkPoint> Ema { get; init; } = [];
    public IReadOnlyList<SparkPoint> Vwap { get; init; } = [];
    public double? VwapDistance { get; init; }
    public double? RelativeVolume { get; init; }
    public double? RangePosition { get; init; }
    private const int ComparableSessionLimit = 5;
    private const int MinimumComparableSessions = 3;

    public string SessionLabel(LocalizationService loc) =>
        loc[Session == MarketSession.PreMarket ? "Quote_Pre" : Session == MarketSession.AfterHours ? "Quote_Post" : "Workspace_RegularSession"];
    public IReadOnlyList<string> AxisLabels
    {
        get
        {
            var (start, end) = MarketClock.UsSessionBounds(Session);
            static string Label(TimeSpan time) => time.ToString(@"hh\:mm");
            return [Label(start), Label(start + (end - start) / 2), Label(end)];
        }
    }

    public static async Task<BarSeries> LoadBarsAsync(IMarketDataService data, string symbol, DateTimeOffset now, CancellationToken ct)
    {
        var series = await data.GetBarsAsync(new BarRequest(symbol, BarInterval.Minute5, now.AddDays(-10)), ct);
        if (series.Interval != BarInterval.Minute5 || !string.Equals(series.Symbol, symbol, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Mismatched chart symbol or interval");
        return series;
    }

    public static IntradaySparkline ForQuote(BarSeries series, Quote? quote, DateTimeOffset now,
        IntradayView view = IntradayView.Automatic, SparklineSettings? indicators = null)
    {
        if (!series.Interval.IsIntraday()) return Empty;
        var stamped = series.Bars.Where(bar => bar.Time <= now)
            .OrderBy(bar => bar.Time).DistinctBy(bar => bar.Time)
            .Select(bar => (Bar: bar, Eastern: MarketClock.ToEastern(bar.Time))).ToArray();
        var sessions = stamped.Where(item => MarketClock.ClassifyUsSession(item.Eastern.TimeOfDay) != MarketSession.Closed)
            .GroupBy(item => (Day: DateOnly.FromDateTime(item.Eastern), Session: MarketClock.ClassifyUsSession(item.Eastern.TimeOfDay)))
            .Where(group => group.Count(item => ValidPrice(item.Bar.Close)) >= 2)
            .OrderBy(group => group.Key.Day).ThenBy(group => group.Key.Session).ToArray();
        var requested = view switch
        {
            IntradayView.Regular => MarketSession.Regular,
            IntradayView.PreMarket => MarketSession.PreMarket,
            IntradayView.AfterHours => MarketSession.AfterHours,
            _ => (MarketSession?)null
        };
        var selected = sessions.LastOrDefault(group => requested is null || group.Key.Session == requested);
        if (selected is null) return Empty;
        var (day, session) = selected.Key;
        var quoteDay = quote?.AsOf is { } time ? DateOnly.FromDateTime(MarketClock.ToEastern(time)) : (DateOnly?)null;
        // After-hours moves use the same day's regular close. Earlier sessions use that day's prior close.
        var baseline = quoteDay != day ? null : session == MarketSession.AfterHours ? quote?.Price : quote?.PreviousClose;
        var bars = selected.ToArray();
        var duration = series.Interval.Duration();
        var (start, end) = MarketClock.UsSessionBounds(session);
        var completed = bars.LastOrDefault(item => item.Bar.Time + duration <= now &&
            item.Eastern.TimeOfDay + duration <= end);
        var comparable = sessions.Where(group => group.Key.Session == session && group.Key.Day < day)
            .Reverse();
        var relativeVolume = completed.Bar is null ? null : MatchedRelativeVolume(bars, comparable,
            start, completed.Eastern.TimeOfDay, duration);
        return Build(series, day, session, bars, baseline, indicators?.Normalized()) with { RelativeVolume = relativeVolume };
    }

    public bool HasGapGuides => Points.Any(p => p.GapGuide);
    public double SampleWidth { get; init; }

    // Only select inside a real sample's half-interval, never across a missing span or future tail.
    public SparkPoint? HitTest(double x)
    {
        if(!double.IsFinite(x)||x<0||x>1)return null;
        var nearest=Points.Where(p=>p.Bar is not null).MinBy(p=>Math.Abs(p.X-x));
        return nearest is not null && Math.Abs(nearest.X-x)<=SampleWidth/2+1e-10?nearest:null;
    }

    public static string Tooltip(SparkPoint point,LocalizationService loc)
    {
        if(point.Bar is not { } bar)return "";
        static string Price(double value)=>double.IsFinite(value)&&value>0?NumberDisplay.Price(value):"—";
        var time=MarketClock.ToEastern(bar.Time).ToString("yyyy-MM-dd HH:mm:ss",System.Globalization.CultureInfo.InvariantCulture)+" ET\n";
        // Push tails are close-only observations, not synthetic candles.
        if(!new[]{bar.Open,bar.High,bar.Low}.Any(v=>double.IsFinite(v)&&v>0))
            return time+$"{loc["QP_ClosePrice"]}  {Price(bar.Close)}";
        return time+$"{loc["QP_OpenPrice"]}  {Price(bar.Open)}    {loc["QP_High"]}  {Price(bar.High)}\n"+
            $"{loc["QP_Low"]}  {Price(bar.Low)}    {loc["QP_ClosePrice"]}  {Price(bar.Close)}"+
            (bar.Incomplete?"\n"+loc["Ch_IncompleteBar"]:"");
    }

    public static readonly IntradaySparkline Empty=new([],null,null,"",false);
    public string StartLabel => WindowStart is { } first ? WindowEnd==first ? "—" : WindowLabel(first) : Session == MarketSession.Closed ? "—" : Session == MarketSession.Overnight ? "20:00" : Session == MarketSession.PreMarket ? "04:00" : Session == MarketSession.AfterHours ? "16:00" : "09:30";
    public string MiddleLabel => WindowStart is { } first && WindowEnd is { } last ? WindowLabel(first+(last-first)/2) : Session == MarketSession.Closed ? "—" : Session == MarketSession.Overnight ? "00:00" : Session == MarketSession.PreMarket ? "06:45" : Session == MarketSession.AfterHours ? "18:00" : "12:45";
    public string EndLabel => WindowEnd is { } last ? WindowStart==last ? "—" : WindowLabel(last) : Session == MarketSession.Closed ? "—" : Session == MarketSession.Overnight ? "04:00" : Session == MarketSession.PreMarket ? "09:30" : Session == MarketSession.AfterHours ? "20:00" : "16:00";
    private string WindowLabel(DateTimeOffset at) => MarketClock.ToEastern(at).ToString(WindowEnd-WindowStart<TimeSpan.FromMinutes(2)?"HH:mm:ss":"HH:mm");
    public static DateOnly SessionDay(DateTimeOffset at, MarketSession session)
    {
        var eastern = MarketClock.ToEastern(at);
        return DateOnly.FromDateTime(session == MarketSession.Overnight && eastern.Hour < 4 ? eastern.AddDays(-1) : eastern);
    }
    // Each session has its own fixed Eastern axis; never splice an earlier day's chart beneath a newer quote.
    public static IntradaySparkline Create(BarSeries series,double? previous,DateTimeOffset now, MarketSession session = MarketSession.Regular, bool fitObserved = false)
    {
        var empty = Empty with { Session = session };
        var start = session == MarketSession.Overnight ? 1200 : session == MarketSession.PreMarket ? 240 : session == MarketSession.AfterHours ? 960 : 570;
        var end = session == MarketSession.Overnight ? 1680 : session == MarketSession.PreMarket ? 570 : session == MarketSession.AfterHours ? 1200 : 960;
        if(!series.Interval.IsIntraday() || session == MarketSession.Closed)return empty;
        double Minute(DateTimeOffset at) { var minutes = MarketClock.ToEastern(at).TimeOfDay.TotalMinutes; return session == MarketSession.Overnight && minutes < 240 ? minutes + 1440 : minutes; }
        var bars=series.Bars.Where(b=>b.Time<=now).OrderBy(b=>b.Time).DistinctBy(b=>b.Time)
            .Where(b=>{var t=Minute(b.Time);return t>=start&&t<end;}).ToArray();
        if(bars.Length==0)return empty;
        var day=SessionDay(bars[^1].Time,session);bars=bars.Where(b=>SessionDay(b.Time,session)==day).ToArray();
        var values=bars.Where(b=>double.IsFinite(b.Close)&&b.Close>0).Select(b=>b.Close).ToList();if(values.Count<1)return empty;
        if(previous is >0 && double.IsFinite(previous.Value))values.Add(previous.Value);
        var lo=values.Min();var hi=values.Max();var span=Math.Max(hi-lo,Math.Max(hi*.001,0.001));
        double Y(double p)=>hi==lo?.5:.1+.8*(hi-p)/span;
        var fit=fitObserved && session==MarketSession.Overnight;
        var firstTime=bars[0].Time;var lastTime=bars[^1].Time;
        double X(DateTimeOffset at) => fit ? lastTime==firstTime ? .5 : (at-firstTime).TotalSeconds/(lastTime-firstTime).TotalSeconds : (Minute(at)-start)/(end-start);
        var result=new List<SparkPoint>();DateTimeOffset? last=null;var broken=true;
        foreach(var b in bars){if(!double.IsFinite(b.Close)||b.Close<=0){broken=true;continue;}var gap=last is { } t && (fit ? b.Time-t>=TimeSpan.FromMinutes(2) : b.Time-t>=series.Interval.Duration()*2);result.Add(new(X(b.Time),Y(b.Close),broken||gap,fit && gap && !broken){Bar=b});last=b.Time;broken=false;}
        return new(result,day,previous is >0&&double.IsFinite(previous.Value)?Y(previous.Value):null,series.Source,series.OfflineCache,session,bars[^1].Time,fit?firstTime:null,fit?lastTime:null){SampleWidth=fit ? lastTime==firstTime ? .02 : series.Interval.Duration().TotalSeconds/(lastTime-firstTime).TotalSeconds : series.Interval.Duration().TotalMinutes/(end-start)};
    }

    private static double? MatchedRelativeVolume((Bar Bar, DateTime Eastern)[] current,
        IEnumerable<IEnumerable<(Bar Bar, DateTime Eastern)>> priorSessions, TimeSpan start, TimeSpan cutoff, TimeSpan interval)
    {
        // Match completed bar slots from the session open. A truncated history or an interior gap cannot supply a baseline.
        var currentVolume = CumulativeVolume(current);
        if (currentVolume is null) return null;
        var comparable = priorSessions.Select(CumulativeVolume).OfType<double>().Take(ComparableSessionLimit).ToArray();
        return comparable.Length >= MinimumComparableSessions
            ? Indicators.RelativeVolume(currentVolume.Value, comparable) : null;

        double? CumulativeVolume(IEnumerable<(Bar Bar, DateTime Eastern)> bars)
        {
            var next = start;
            double total = 0;
            foreach (var (bar, eastern) in bars)
            {
                var time = eastern.TimeOfDay;
                if (time > cutoff) break;
                // The feed model also uses zero for an omitted volume.
                if (time != next || !double.IsFinite(bar.Volume) || bar.Volume <= 0) return null;
                total += bar.Volume;
                next += interval;
            }
            return next == cutoff + interval && double.IsFinite(total) && total > 0 ? total : null;
        }
    }

    private static bool CompletePrices(Bar bar) => !bar.Incomplete && bar.IsConsistent() && bar.Low > 0;

    private static bool ValidPrice(double price) => double.IsFinite(price) && price > 0;

    private static IntradaySparkline Build(BarSeries series, DateOnly day, MarketSession session,
        (Bar Bar, DateTime Eastern)[] bars, double? previous, SparklineSettings? indicators = null)
    {
        var values = bars.Where(item => ValidPrice(item.Bar.Close)).Select(item => item.Bar.Close).ToList();
        if (values.Count < 2) return Empty;
        var hasBaseline = previous is { } reference && ValidPrice(reference);
        if (hasBaseline) values.Add(previous!.Value);
        var vwap = indicators is { ShowVwap: true } ? SessionVwap(bars) : [];
        var finiteVwap = vwap.Where(double.IsFinite);
        var lo = values.Concat(finiteVwap).Min();
        var hi = values.Concat(finiteVwap).Max();
        var span = Math.Max(hi - lo, Math.Max(hi * .001, .001));
        double Y(double price) => hi == lo ? .5 : .1 + .8 * (hi - price) / span;
        var (start, end) = MarketClock.UsSessionBounds(session);
        var result = new List<SparkPoint>();
        var vwapPoints = new List<SparkPoint>();
        var vwapBreak = true;
        var indexInSession = 0;
        var rangePosition = bars.All(item => CompletePrices(item.Bar))
            ? Indicators.RangePosition(bars[^1].Bar.Close, bars.Min(item => item.Bar.Low), bars.Max(item => item.Bar.High))
            : null;
        DateTimeOffset? last = null;
        var broken = true;
        foreach (var (bar, eastern) in bars)
        {
            var weightedPrice = vwap.Length > 0 ? vwap[indexInSession] : double.NaN;
            indexInSession++;
            if (!ValidPrice(bar.Close)) { broken = vwapBreak = true; continue; }
            var gap = last is { } time && bar.Time - time > series.Interval.Duration() * 2;
            var x = (eastern.TimeOfDay - start) / (end - start);
            result.Add(new(x, Y(bar.Close), broken || gap) { Bar = bar });
            if (double.IsFinite(weightedPrice))
                vwapPoints.Add(new(x, Y(weightedPrice), vwapBreak || gap));
            vwapBreak = !double.IsFinite(weightedPrice);
            last = bar.Time;
            broken = false;
        }
        var graph = new IntradaySparkline(result, day, hasBaseline ? Y(previous!.Value) : null, series.Source, series.OfflineCache)
        {
            Session = session,
            AsOf = last,
            SampleWidth = series.Interval.Duration() / (end - start),
            Vwap = vwapPoints,
            VwapDistance = vwap.Length > 0 && vwap[^1] > 0 ? (bars[^1].Bar.Close / vwap[^1] - 1) : null,
            RangePosition = rangePosition
        };
        if (indicators is not { ShowMa: true } && indicators is not { ShowEma: true }) return graph;
        // Work on each uninterrupted run of real prices, using the same indicator algorithms as the full charts.
        var ma = new List<SparkPoint>();
        var ema = new List<SparkPoint>();
        var offset = 0;
        for (var index = 1; index < result.Count; index++)
        {
            if (!result[index].Break) continue;
            AddRun(index);
            offset = index;
        }
        AddRun(result.Count);
        return graph with { Ma = ma, Ema = ema };

        void AddRun(int endIndex)
        {
            var closes = CollectionsMarshal.AsSpan(values)[offset..endIndex];
            if (indicators is { ShowMa: true } && closes.Length > indicators.MaPeriod)
                AddPoints(ma, Indicators.Sma(closes, indicators.MaPeriod));
            if (indicators is { ShowEma: true } && closes.Length > indicators.EmaPeriod)
                AddPoints(ema, Indicators.Ema(closes, indicators.EmaPeriod));
        }

        void AddPoints(List<SparkPoint> target, double[] average)
        {
            var first = true;
            for (var index = 0; index < average.Length; index++)
            {
                if (!double.IsFinite(average[index])) { first = true; continue; }
                target.Add(new SparkPoint(result[offset + index].X, Y(average[index]), first));
                first = false;
            }
        }
    }

    private static double[] SessionVwap((Bar Bar, DateTime Eastern)[] bars)
    {
        // This slice contains exactly one pre-market, regular, or after-hours session.
        var input = bars.Select(item =>
        {
            var bar = item.Bar;
            return new OhlcvBar(bar.Time, bar.Open, bar.High, bar.Low, bar.Close,
                CompletePrices(bar) ? bar.Volume : double.NaN);
        }).ToArray();
        var weighted = Indicators.Vwap(OhlcvColumns.From(input));
        for (var index = 0; index < input.Length; index++)
            if (!double.IsFinite(input[index].Volume) || input[index].Volume < 0) weighted[index] = double.NaN;
        return weighted;
    }
}
