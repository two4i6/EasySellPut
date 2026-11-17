using Meili.Core.Models;
namespace Meili.Core.Quotes;

/// <summary>Bounded source observations only. No interpolation, timers, network or disk writes.</summary>
public sealed class OvernightObservationBuffer
{
    private readonly object _gate=new();
    private sealed class Bucket
    {
        public readonly SortedDictionary<long,QuoteTick> Points=[];
        public long CompactedMinute=long.MinValue;
    }
    private readonly Dictionary<string,Bucket> _symbols=new(StringComparer.OrdinalIgnoreCase);
    public static readonly TimeSpan Retention=TimeSpan.FromHours(10);
    public const int MaxSymbols=50,MaxPoints=1024;
    public void Add(QuoteTick tick,DateTimeOffset now)
    {
        if(tick.Session!=MarketState.Overnight||!double.IsFinite(tick.Price)||tick.Price<=0||string.IsNullOrWhiteSpace(tick.Symbol)||tick.Time>now.AddMinutes(1)||now-tick.Time>Retention)return;
        lock(_gate)
        {
            if(!_symbols.TryGetValue(tick.Symbol,out var bucket))
            {
                if(_symbols.Count>=MaxSymbols)_symbols.Remove(_symbols.MinBy(p=>p.Value.Points.LastOrDefault().Value?.Time??DateTimeOffset.MinValue).Key);
                _symbols[tick.Symbol]=bucket=new();
            }
            var key=tick.Time.ToUnixTimeSeconds();
            if(bucket.Points.TryGetValue(key,out var old)&&old.Time>tick.Time)return;
            bucket.Points[key]=tick;
            if(bucket.CompactedMinute!=key/60)
            {
                bucket.CompactedMinute=key/60;
                // Retain recent second-level source detail and older actual minute observations.
                foreach(var group in bucket.Points.Where(p=>p.Value.Time<now.AddMinutes(-5)).GroupBy(p=>p.Key/60).ToArray())
                    foreach(var point in group.SkipLast(1))bucket.Points.Remove(point.Key);
                foreach(var point in bucket.Points.Where(p=>now-p.Value.Time>Retention).ToArray())bucket.Points.Remove(point.Key);
            }
            while(bucket.Points.Count>MaxPoints)bucket.Points.Remove(bucket.Points.Keys.First());
        }
    }
    public IReadOnlyList<QuoteTick> Snapshot(string symbol,DateTimeOffset now)
    {
        lock(_gate)return _symbols.TryGetValue(symbol,out var bucket)?bucket.Points.Values.Where(p=>now-p.Time<=Retention&&p.Time<=now).ToArray():[];
    }
    public (int Count,int Expired) Inspect(DateTimeOffset now)
    {
        lock(_gate)return(_symbols.Values.Sum(b=>b.Points.Count),_symbols.Values.Sum(b=>b.Points.Values.Count(p=>now-p.Time>Retention)));
    }
    public int Clear(bool expiredOnly,DateTimeOffset now)
    {
        lock(_gate)
        {
            var removed=0;
            foreach(var bucket in _symbols.Values)
            {
                var keys=bucket.Points.Where(p=>!expiredOnly||now-p.Value.Time>Retention).Select(p=>p.Key).ToArray();
                foreach(var key in keys)bucket.Points.Remove(key);removed+=keys.Length;
            }
            foreach(var symbol in _symbols.Where(p=>p.Value.Points.Count==0).Select(p=>p.Key).ToArray())_symbols.Remove(symbol);
            return removed;
        }
    }
}
