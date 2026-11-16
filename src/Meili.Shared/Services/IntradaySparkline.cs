using Meili.Core.Models;
using Meili.Core.Time;
namespace Meili.Shared.Services;

public sealed record SparkPoint(double X,double Y,bool Break=false);
public sealed record IntradaySparkline(IReadOnlyList<SparkPoint> Points,DateOnly? Day,double? Baseline,string Source,bool Offline, MarketSession Session = MarketSession.Regular, DateTimeOffset? AsOf = null)
{
    public static readonly IntradaySparkline Empty=new([],null,null,"",false);
    public string StartLabel => Session == MarketSession.Closed ? "—" : Session == MarketSession.PreMarket ? "04:00" : Session == MarketSession.AfterHours ? "16:00" : "09:30";
    public string MiddleLabel => Session == MarketSession.Closed ? "—" : Session == MarketSession.PreMarket ? "06:45" : Session == MarketSession.AfterHours ? "18:00" : "12:45";
    public string EndLabel => Session == MarketSession.Closed ? "—" : Session == MarketSession.PreMarket ? "09:30" : Session == MarketSession.AfterHours ? "20:00" : "16:00";
    // Each session has its own fixed Eastern axis; never splice an earlier day's chart beneath a newer quote.
    public static IntradaySparkline Create(BarSeries series,double? previous,DateTimeOffset now, MarketSession session = MarketSession.Regular)
    {
        var empty = Empty with { Session = session };
        var start = session == MarketSession.PreMarket ? 240 : session == MarketSession.AfterHours ? 960 : 570;
        var end = session == MarketSession.PreMarket ? 570 : session == MarketSession.AfterHours ? 1200 : 960;
        if(!series.Interval.IsIntraday())return empty;
        var bars=series.Bars.Where(b=>b.Time<=now).OrderBy(b=>b.Time).DistinctBy(b=>b.Time)
            .Where(b=>{var t=MarketClock.ToEastern(b.Time).TimeOfDay.TotalMinutes;return t>=start&&t<end;}).ToArray();
        if(bars.Length==0)return empty;
        var day=DateOnly.FromDateTime(MarketClock.ToEastern(bars[^1].Time));bars=bars.Where(b=>DateOnly.FromDateTime(MarketClock.ToEastern(b.Time))==day).ToArray();
        var values=bars.Where(b=>double.IsFinite(b.Close)&&b.Close>0).Select(b=>b.Close).ToList();if(values.Count<2)return empty;
        if(previous is >0 && double.IsFinite(previous.Value))values.Add(previous.Value);
        var lo=values.Min();var hi=values.Max();var span=Math.Max(hi-lo,Math.Max(hi*.001,0.001));
        double Y(double p)=>hi==lo?.5:.1+.8*(hi-p)/span;
        var result=new List<SparkPoint>();DateTimeOffset? last=null;var broken=true;
        foreach(var b in bars){if(!double.IsFinite(b.Close)||b.Close<=0){broken=true;continue;}var gap=last is { } t && b.Time-t>series.Interval.Duration()*2;result.Add(new((MarketClock.ToEastern(b.Time).TimeOfDay.TotalMinutes-start)/(end-start),Y(b.Close),broken||gap));last=b.Time;broken=false;}
        return new(result,day,previous is >0&&double.IsFinite(previous.Value)?Y(previous.Value):null,series.Source,series.OfflineCache,session,bars[^1].Time);
    }
}
