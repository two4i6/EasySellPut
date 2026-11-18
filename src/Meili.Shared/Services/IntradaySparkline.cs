using Meili.Core.Models;
using Meili.Core.Time;
namespace Meili.Shared.Services;

public sealed record SparkPoint(double X,double Y,bool Break=false, bool GapGuide=false)
{
    public Bar? Bar { get; init; }
}
public sealed record IntradaySparkline(IReadOnlyList<SparkPoint> Points,DateOnly? Day,double? Baseline,string Source,bool Offline, MarketSession Session = MarketSession.Regular, DateTimeOffset? AsOf = null, DateTimeOffset? WindowStart = null, DateTimeOffset? WindowEnd = null)
{
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
}
