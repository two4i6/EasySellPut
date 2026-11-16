using System.Globalization;
using Meili.Core.Models;
using Meili.Core.Time;
namespace Meili.Shared.Services;

/// <summary>In-memory source-time join. Does not write observed prices into the historical bar cache.</summary>
public sealed class LiveBarStitcher
{
    private BarSeries? _history;
    private QuoteTick? _unbucketed;
    private Dictionary<DateTimeOffset,Bar> _authoritative=[];
    private readonly SortedDictionary<DateTimeOffset,QuoteTick> _ticks=[];
    public void SetHistory(BarSeries history)
    {
        if(_history is { } old&&(old.Symbol!=history.Symbol||old.Interval!=history.Interval||old.Adjustment!=history.Adjustment||old.Source!=history.Source)){_ticks.Clear();_unbucketed=null;}
        _history=history with{Bars=history.Bars.Where(b=>history.Source!="yahoo"||!history.Interval.IsIntraday()||b.Time.ToUnixTimeSeconds()%60==0).GroupBy(b=>b.Time).Select(g=>g.Last()).OrderBy(b=>b.Time).ToArray()};
        _authoritative=_history.Bars.ToDictionary(b=>b.Time);
        // Rebucket against the actual provider grid (including hourly :30 anchors).
        var buffered=_ticks.Values.Concat(_unbucketed is null?[]:new[]{_unbucketed}).ToArray();_ticks.Clear();_unbucketed=null;foreach(var tick in buffered)Observe(tick);
    }
    public void Observe(QuoteTick tick)
    {
        if(_history is not { } h||tick.Symbol!=h.Symbol||!double.IsFinite(tick.Price)||tick.Price<=0||tick.Time>DateTimeOffset.UtcNow.AddMinutes(1))return;
        var time=Bucket(h,tick);if(time is null){if(_unbucketed is null||tick.Time>_unbucketed.Time)_unbucketed=tick;return;}
        if(_ticks.TryGetValue(time.Value,out var prior)&&prior.Time>tick.Time)return;
        _ticks[time.Value]=tick;while(_ticks.Count>128)_ticks.Remove(_ticks.Keys.First());
    }
    public LiveBarView View(DateTimeOffset now)
    {
        var h=_history??throw new InvalidOperationException("Historical bars are required.");
        if(h.Adjustment==PriceAdjustment.SplitDividend)return new(h,[],"adjustment_unverified",null,null,null);
        var last=h.Bars.LastOrDefault();if(last is null)return new(h,[],"waiting_history",null,null,null);
        var authoritative=_authoritative;List<Bar> tail=[];var cursor=last.Time;string? source=null;
        foreach(var (time,tick) in _ticks.ToArray())
        {
            if(time<last.Time||authoritative.TryGetValue(time,out var bar)&&bar.IsConsistent()&&Closed(h.Interval,time,now)&&Closed(h.Interval,time,h.FetchedAt??h.AsOf??DateTimeOffset.MinValue))continue;
            if(time>cursor)
            {
                var expected=Next(h.Interval,cursor);
                if(expected<time)return new(h,tail,"repairing",expected,time,source??tick.Source);
            }
            tail.Add(Bar.CloseOnly(time,tick.Price,double.NaN));cursor=time;source=tick.Source;
        }
        if(_unbucketed is { } pending&&pending.Session==MarketState.Regular)return new(h,tail,"waiting_history",last.Time,pending.Time,pending.Source);
        return new(h,tail,tail.Count>0?"joined":"waiting_price",null,null,source);
    }
    private static bool Closed(BarInterval interval,DateTimeOffset time,DateTimeOffset now)
    {
        if(interval.IsIntraday())return time+interval.Duration()<=now;
        var date=DateOnly.FromDateTime(MarketClock.ToEastern(time));
        return interval==BarInterval.Day1&&MarketClock.FromEastern(date.ToDateTime(new TimeOnly(16,0)))<=now;
    }
    private static DateTimeOffset? Bucket(BarSeries h,QuoteTick tick)
    {
        var et=MarketClock.ToEastern(tick.Time);var date=DateOnly.FromDateTime(et);
        if(!h.Interval.IsIntraday())
        {
            if(tick.Session!=MarketState.Regular)return null;
            bool Same(DateTimeOffset time)
            {
                var d=MarketClock.ToEastern(time);
                return h.Interval switch{BarInterval.Day1=>d.Date==et.Date,BarInterval.Week1=>ISOWeek.GetYear(d)==ISOWeek.GetYear(et)&&ISOWeek.GetWeekOfYear(d)==ISOWeek.GetWeekOfYear(et),_=>d.Year==et.Year&&d.Month==et.Month};
            }
            for(var i=h.Bars.Count-1;i>=0;i--)if(Same(h.Bars[i].Time))return h.Bars[i].Time;
            return null; // Wait for the provider's current-period anchor, never invent one.
        }
        var session=tick.Session switch{MarketState.PreMarket=>MarketSession.PreMarket,MarketState.Regular=>MarketSession.Regular,MarketState.AfterHours=>MarketSession.AfterHours,_=>MarketSession.Closed};
        if(session==MarketSession.Closed)return null;
        DateTimeOffset? known=null;
        for(var i=h.Bars.Count-1;i>=0;i--){var bar=h.Bars[i];if(bar.Time>tick.Time)continue;var day=DateOnly.FromDateTime(MarketClock.ToEastern(bar.Time));if(day<date)break;if(day==date&&MarketClock.GetSession(bar.Time)==session){known=bar.Time;break;}}
        var anchor=known??MarketClock.FromEastern(date.ToDateTime(session==MarketSession.PreMarket?new TimeOnly(4,0):session==MarketSession.Regular?new TimeOnly(9,30):new TimeOnly(16,0)));
        var span=h.Interval.Duration().Ticks;var offset=tick.Time.UtcTicks-anchor.UtcTicks;
        return anchor.AddTicks((long)Math.Floor((double)offset/span)*span);
    }
    private static DateTimeOffset Next(BarInterval interval,DateTimeOffset time)
    {
        if(!interval.IsIntraday())return time+interval.Duration();
        var next=time+interval.Duration();
        if(MarketClock.GetSession(next)!=MarketSession.Closed)return next;
        var et=MarketClock.ToEastern(next);var day=DateOnly.FromDateTime(et);
        if(MarketClock.IsTradingDay(day)&&et.TimeOfDay<TimeSpan.FromHours(4))return MarketClock.FromEastern(day.ToDateTime(new TimeOnly(4,0)));
        do{day=day.AddDays(1);}while(!MarketClock.IsTradingDay(day));
        return MarketClock.FromEastern(day.ToDateTime(new TimeOnly(4,0)));
    }
}
