using Meili.Core.Abstractions;
using Meili.Core.Models;

namespace Meili.Core.Quotes;

/// <summary>One quote round-trip, broadcast to every listener.</summary>
public sealed record QuoteBatch(
    IReadOnlyList<string> Requested,
    IReadOnlyList<Quote> Quotes,
    Exception? Error,
    DateTimeOffset At,
    bool IsStreaming = false)
{
    public bool Covers(string symbol) => Requested.Contains(symbol, StringComparer.OrdinalIgnoreCase);

    public Quote? Find(string symbol) =>
        Quotes.FirstOrDefault(q => string.Equals(q.Symbol, symbol, StringComparison.OrdinalIgnoreCase));
}

/// <summary>
/// C1: the single place quotes are fetched. Pages and the alert monitor <see cref="Subscribe"/> their symbols;
/// <see cref="PollAsync"/> (driven by one app-level timer) fetches the union in one request and raises
/// <see cref="Updated"/>. On-demand reads go through <see cref="GetQuotesAsync"/>, which serves quotes younger than
/// <see cref="Ttl"/> from memory, shares an identical in-flight request, and piggybacks other subscribers' stale
/// symbols onto the same request. Health counters feed F10 ("monitoring interrupted").
/// </summary>
/// <remarks>
/// Not thread-affine by itself; continuations resume on the caller's context (no ConfigureAwait(false)), so when the
/// UI thread drives it, <see cref="Updated"/> is raised on the UI thread.
/// </remarks>
public sealed class QuoteHub : IManagedCache
{
    public string CacheId => "quotes";
    private readonly IMarketDataService _data;
    private readonly Dictionary<string, HashSet<string>> _subs = new(StringComparer.Ordinal);
    private readonly Dictionary<string, (Quote Quote, DateTimeOffset At)> _cache = new(StringComparer.OrdinalIgnoreCase);
    private readonly object _gate = new();
    private readonly Dictionary<string,DateTimeOffset> _lastSnapshots=new(StringComparer.OrdinalIgnoreCase);
    private (HashSet<string> Symbols, Task<QuoteBatch> Task)? _inflight;

    private readonly OvernightObservationBuffer _overnight = new();
    public IReadOnlyList<QuoteTick> GetOvernightObservations(string symbol) => _overnight.Snapshot(symbol,Now());
    private long _generation;
    public CacheStatus Inspect()
    {
        lock (_gate)
        {
            var night=_overnight.Inspect(Now());
            return new("quotes", "memory", "process", _cache.Count+night.Count, _cache.Values.LongCount(e => Now() - e.At >= Ttl)+night.Expired, null, null, null,
                "Quote TTL 2.5 seconds. Overnight observations: 10 hours, at most 50 symbols/1024 source points each, recent second detail and older minute samples. Clear removes observations and invalidates quote reuse, retaining displayed quotes and subscribers.");
        }
    }
    public CacheClearResult Clear(bool expiredOnly, string? symbol = null)
    {
        if (symbol is not null) throw new ArgumentException("Quote invalidation does not support symbol filtering.");
        lock (_gate)
        {
            var keys = _cache.Where(e => !expiredOnly || Now() - e.Value.At >= Ttl).Select(e => e.Key).ToArray();
            var removed=_overnight.Clear(expiredOnly,Now());
            if (expiredOnly && keys.Length == 0 && removed==0) return new("quotes", 0);
            _generation++; _inflight = null; _lastSnapshots.Clear();
            foreach (var key in keys) _cache[key] = (_cache[key].Quote, DateTimeOffset.MinValue);
            return new("quotes", removed, keys.Length);
        }
    }

    public QuoteHub(IMarketDataService data) => _data = data;

    public TimeSpan Ttl { get; init; } = TimeSpan.FromSeconds(2.5);
    public TimeSpan RequestTimeout { get; init; } = TimeSpan.FromSeconds(45);
    public Func<DateTimeOffset> Now { get; set; } = () => DateTimeOffset.UtcNow;

    public int ConsecutiveFailures { get; private set; }
    public DateTimeOffset? LastSuccess { get; private set; }
    public Exception? LastError { get; private set; }
    public int RequestCount { get; private set; }

    public event EventHandler<QuoteBatch>? Updated;
    public event EventHandler? SubscriptionsChanged;

    public IReadOnlyList<string> SubscribedSymbols
    {
        get
        {
            lock (_gate)
                return _subs.Values.SelectMany(s => s).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        }
    }

    /// <summary>Replaces <paramref name="owner"/>'s symbol set.</summary>
    public void Subscribe(string owner, IEnumerable<string> symbols)
    {
        var set = new HashSet<string>(symbols.Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s.Trim().ToUpperInvariant()),
            StringComparer.OrdinalIgnoreCase);
        lock (_gate){if(_subs.TryGetValue(owner,out var old)&&old.SetEquals(set))return;_subs[owner]=set;}
        SubscriptionsChanged?.Invoke(this,EventArgs.Empty);
    }

    public void Unsubscribe(string owner)
    {
        lock (_gate){if(!_subs.Remove(owner))return;}
        SubscriptionsChanged?.Invoke(this,EventArgs.Empty);
    }

    public bool TryGetCached(string symbol, out Quote quote)
    {
        lock (_gate)
        {
            if (_cache.TryGetValue(symbol, out var e)) { quote = e.Quote; return true; }
        }
        quote = null!;
        return false;
    }

    /// <summary>Source push ingestion; caller marshals the batch to its UI. Never rolls back source time or invents a regular close from an extended trade.</summary>
    public void ApplyTicks(IReadOnlyList<QuoteTick> ticks)
    {
        var requested=SubscribedSymbols;var updated=new Dictionary<string,Quote>(StringComparer.OrdinalIgnoreCase);var now=Now();
        lock(_gate)
        {
            foreach(var tick in ticks)
            {
                if(!requested.Contains(tick.Symbol,StringComparer.OrdinalIgnoreCase)||!double.IsFinite(tick.Price)||tick.Price<=0||tick.Time>now.AddMinutes(1))continue;
                _cache.TryGetValue(tick.Symbol,out var cached);var previous=cached.Quote;
                if(tick.Session==MarketState.Regular)
                {
                    if(previous?.AsOf is { } old&&old>tick.Time||previous?.ExtendedTime>tick.Time)continue;
                    var quote=(previous??new Quote{Symbol=tick.Symbol}) with
                    {
                        Price=tick.Price,AsOf=tick.Time,FetchedAt=now,Source=tick.Source,Delivery="websocket",StreamState="active",StreamStateAt=now,IsRealtime=false,DelayMinutes=null,
                        MarketState=MarketState.Regular,Change=tick.Change??(previous?.PreviousClose is >0 and var close&&double.IsFinite(close)?tick.Price-close:null),ChangePercent=tick.ChangePercent??(previous?.PreviousClose is >0 and var basis&&double.IsFinite(basis)?(tick.Price/basis-1)*100:null),Volume=tick.Volume,
                        Name=previous?.Name??tick.Name,Currency=tick.Currency??previous?.Currency??"USD",Exchange=tick.Exchange??previous?.Exchange,
                        Bid=null,Ask=null,BidSize=null,AskSize=null,ExtendedPrice=null,ExtendedTime=null,ExtendedChange=null,ExtendedChangePercent=null,ExtendedSource=null,ExtendedDelivery=null
                    };
                    _cache[tick.Symbol]=(quote,now);updated[tick.Symbol]=quote;
                }
                else if(tick.Session==MarketState.Overnight || tick.Session is MarketState.PreMarket or MarketState.AfterHours && previous is {Price:>0}&&double.IsFinite(previous.Price))
                {
                    previous ??= new Quote{Symbol=tick.Symbol,Price=double.NaN,Source=tick.Source,Name=tick.Name,Currency=tick.Currency??"USD",Exchange=tick.Exchange};
                    var latest=previous.AsOf;if(previous.ExtendedTime is { } extended&&(latest is null||extended>latest))latest=extended;if(latest is { } old&&old>=tick.Time)continue;
                    if(tick.Session==MarketState.Overnight)_overnight.Add(tick,now);
                    var hasClose=previous.Price>0&&double.IsFinite(previous.Price);
                    var quote=previous with{ExtendedPrice=tick.Price,ExtendedTime=tick.Time,ExtendedChange=hasClose?tick.Price-previous.Price:tick.Change is { } change&&double.IsFinite(change)?change:null,ExtendedChangePercent=hasClose?(tick.Price/previous.Price-1)*100:tick.ChangePercent is { } pct&&double.IsFinite(pct)?pct:null,MarketState=tick.Session,FetchedAt=now,ExtendedDelivery="websocket",ExtendedSource=tick.Source,StreamState="active",StreamStateAt=now};
                    _cache[tick.Symbol]=(quote,now);updated[tick.Symbol]=quote;
                }
            }
        }
        if(updated.Count>0){lock(_gate){LastSuccess=now;LastError=null;ConsecutiveFailures=0;}}
        if(updated.Count>0)Updated?.Invoke(this,new QuoteBatch(updated.Keys.ToArray(),updated.Values.ToArray(),null,now,true));
    }

    public void MarkStreamInterrupted(IReadOnlyList<string> symbols)
    {
        List<Quote> changed=[];lock(_gate)
        {
            foreach(var symbol in symbols)
                if(_cache.TryGetValue(symbol,out var entry)&&(entry.Quote.Delivery=="websocket"||entry.Quote.ExtendedDelivery=="websocket"))
                {var quote=entry.Quote with{StreamState="reconnecting",StreamStateAt=Now()};_cache[symbol]=(quote,entry.At);changed.Add(quote);}
        }
        if(changed.Count>0)Updated?.Invoke(this,new QuoteBatch(changed.Select(q=>q.Symbol).ToArray(),changed,null,Now(),true));
    }

    /// <summary>Timer tick: one request for every subscribed symbol. No-op without subscribers.</summary>
    public async Task<QuoteBatch?> PollAsync(CancellationToken ct = default)
    {
        var all = SubscribedSymbols;
        if (all.Count == 0) return null;
        List<string> needed;
        lock(_gate) needed=all.Where(s=>!_cache.TryGetValue(s,out var value)||(value.Quote.Delivery!="websocket"&&value.Quote.ExtendedDelivery!="websocket")||value.Quote.StreamState=="reconnecting"||Now()-value.At>TimeSpan.FromSeconds(5)||!_lastSnapshots.TryGetValue(s,out var snapshot)||Now()-snapshot>TimeSpan.FromMinutes(1)).ToList();
        var fresh=all.Except(needed,StringComparer.OrdinalIgnoreCase).ToArray();
        QuoteBatch? cachedBatch=null;
        if(fresh.Length>0)
        {
            lock(_gate)cachedBatch=new(fresh,fresh.Where(_cache.ContainsKey).Select(s=>_cache[s].Quote).ToArray(),null,Now());
            Updated?.Invoke(this,cachedBatch); // Keep alert checks on their original pump cadence without another HTTP request.
        }
        if(needed.Count==0)return cachedBatch;
        return await FetchAsync(needed).WaitAsync(ct);
    }

    /// <summary>
    /// Quotes for <paramref name="symbols"/>: fresh cache entries are returned as-is, the rest are fetched together with
    /// any stale subscribed symbols. Throws what the data service throws (after broadcasting the failure).
    /// </summary>
    public async Task<IReadOnlyList<Quote>> GetQuotesAsync(IReadOnlyList<string> symbols, CancellationToken ct = default)
    {
        var wanted = symbols.Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s.Trim().ToUpperInvariant())
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (wanted.Count == 0) return [];
        var now = Now();
        List<string> stale;
        lock (_gate) stale = wanted.Where(s => !IsFresh(s, now)).ToList();
        if (stale.Count > 0)
        {
            // Piggyback: other subscribers' symbols that are stale too ride along in the same request.
            var extra = SubscribedSymbols.Where(s => !wanted.Contains(s, StringComparer.OrdinalIgnoreCase));
            lock (_gate) extra = extra.Where(s => !IsFresh(s, now)).ToList();
            var batch = await FetchAsync(stale.Concat(extra).ToList()).WaitAsync(ct);
            if (batch.Error is not null) throw batch.Error;
        }
        lock (_gate)
            return wanted.Where(_cache.ContainsKey).Select(s => _cache[s].Quote).ToList();
    }

    private bool IsFresh(string symbol, DateTimeOffset now) =>
        _cache.TryGetValue(symbol, out var e) && now - e.At < Ttl;

    /// <summary>
    /// The shared fetch is detached from its callers: it is bounded only by <see cref="RequestTimeout"/>. Each caller
    /// awaits it with <c>WaitAsync(ct)</c>, so one caller giving up cannot cancel the request the others are sharing.
    /// </summary>
    private Task<QuoteBatch> FetchAsync(IReadOnlyList<string> symbols)
    {
        lock (_gate)
        {
            if (_inflight is { } f && !f.Task.IsCompleted && symbols.All(f.Symbols.Contains))
                return f.Task;
            var task = RunAsync(symbols, _generation);
            _inflight = (new HashSet<string>(symbols, StringComparer.OrdinalIgnoreCase), task);
            return task;
        }
    }

    private async Task<QuoteBatch> RunAsync(IReadOnlyList<string> symbols, long generation)
    {
        RequestCount++;
        QuoteBatch batch;
        using var timeout = new CancellationTokenSource(RequestTimeout);
        try
        {
            var quotes = await _data.GetQuotesAsync(symbols, timeout.Token);
            var at = Now();
            lock (_gate)
                foreach (var q in quotes.Where(q => !string.IsNullOrWhiteSpace(q.Symbol)))
                    if (generation == _generation || !_cache.ContainsKey(q.Symbol))
                        {
                        var value=q with{SnapshotFetchedAt=at,SnapshotSource=q.Source};
                        if(generation==_generation)_lastSnapshots[q.Symbol]=at;
                        if(_cache.TryGetValue(q.Symbol,out var cached)&&(cached.Quote.Delivery=="websocket"||cached.Quote.ExtendedDelivery=="websocket"))
                        {
                            var live=cached.Quote;
                            if(live.AsOf is { } time&&(q.AsOf is null||time>=q.AsOf))
                                value=value with{Source=live.Source,Name=q.Name??live.Name,Price=live.Price,AsOf=live.AsOf,Change=live.Change,ChangePercent=live.ChangePercent,Volume=live.Volume,MarketState=live.MarketState,Delivery=live.Delivery,StreamState=live.StreamState,StreamStateAt=live.StreamStateAt,IsRealtime=live.IsRealtime,DelayMinutes=live.DelayMinutes,FetchedAt=live.FetchedAt,Bid=null,Ask=null,BidSize=null,AskSize=null};
                            if(live.ExtendedTime is { } ext&&(q.AsOf is null||ext>q.AsOf)&&(q.ExtendedTime is null||ext>=q.ExtendedTime))
                                value=value with{ExtendedPrice=live.ExtendedPrice,ExtendedTime=ext,ExtendedChange=live.ExtendedChange,ExtendedChangePercent=live.ExtendedChangePercent,MarketState=live.MarketState,ExtendedDelivery=live.ExtendedDelivery,ExtendedSource=live.ExtendedSource,FetchedAt=live.FetchedAt,StreamState=live.StreamState,StreamStateAt=live.StreamStateAt};
                        }
                        _cache[q.Symbol] = (value, generation == _generation ? at : DateTimeOffset.MinValue);
                    }
            lock (_gate) if (generation == _generation)
            {
                ConsecutiveFailures = 0;
                LastSuccess = at;
                LastError = null;
            }
            lock(_gate) quotes=quotes.Select(q=>_cache.TryGetValue(q.Symbol,out var saved)?saved.Quote:q).ToArray();
            batch = new QuoteBatch(symbols, quotes, null, at);
        }
        catch (OperationCanceledException) when (!timeout.IsCancellationRequested)
        {
            throw; // cancelled by something other than our own timeout; not a source failure
        }
        catch (Exception ex)
        {
            lock (_gate) if (generation == _generation)
            {
                ConsecutiveFailures++;
                LastError = ex;
            }
            Diagnostics.AppLog.Warn("quotes", $"batch failed ({ConsecutiveFailures} in a row)", ex);
            batch = new QuoteBatch(symbols, [], ex, Now());
        }
        bool publish; lock (_gate) publish = generation == _generation;
        if (publish) Updated?.Invoke(this, batch);
        return batch;
    }
}
