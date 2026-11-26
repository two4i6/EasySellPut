using Meili.Shared.Services;
using Meili.Core.Abstractions;
using Meili.Core.Models;
using Meili.Core.Quotes;
using Meili.Core.Settings;
using Meili.Core.Diagnostics;
using Meili.Core.Time;
namespace Meili.Shared.ViewModels;

public sealed class PanelQuoteRow(string symbol)
{
    public string Symbol{get;}=symbol;
    public Quote? Quote{get;internal set;}
    public bool Failed{get;internal set;}
    internal Func<DateTimeOffset> Now = () => DateTimeOffset.UtcNow;
    public QuotePriceView? Display => Quote is { } q ? QuotePriceView.Select(q, Now()) : null;
    private readonly Dictionary<MarketSession, IntradaySparkline> _graphs = new();
    private LiveBarStitcher? _live;
    private BarSeries? _nightHistory;
    private DateTimeOffset? _observedAt;
    internal MarketSession? ChartSession;
    public bool ChartObserved { get; private set; }
    public bool ChartRepairing { get; private set; }
    public IntradaySparkline Graph
    {
        get
        {
            var view = Display; var session = ChartSession ?? view?.Session ?? MarketSession.Regular;
            if (session == MarketSession.Closed) return IntradaySparkline.Empty with { Session = session };
            var graph = _graphs.GetValueOrDefault(session, IntradaySparkline.Empty with { Session = session });
            if (ChartSession is null && view?.Snapshot.AsOf is { } at && graph.Day != IntradaySparkline.SessionDay(at,session))
                return IntradaySparkline.Empty with { Session = session };
            return graph;
        }
    }
    internal void SetGraphs(BarSeries series, DateTimeOffset now)
    {
        _nightHistory=series;
        _graphs[MarketSession.Regular] = IntradaySparkline.Create(series, Quote?.PreviousClose, now);
        _graphs[MarketSession.PreMarket] = IntradaySparkline.Create(series, Quote?.Price, now, MarketSession.PreMarket);
        _graphs[MarketSession.AfterHours] = IntradaySparkline.Create(series, Quote?.Price, now, MarketSession.AfterHours);
        var night = IntradaySparkline.Create(series, Quote?.Price, now, MarketSession.Overnight);
        if(night.Points.Count>0 || !_graphs.TryGetValue(MarketSession.Overnight,out var retained) || retained.Source!=series.Source)
            _graphs[MarketSession.Overnight] = night;
        (_live ??= new()).SetHistory(series);
        _observedAt = null;
        ChartObserved = false; ChartRepairing = false;
        ObserveLive(now);
    }
    internal void ObserveLive(DateTimeOffset now)
    {
        if (_live is null || Display is not { Snapshot: { Delivery: "websocket", AsOf: { } at } } view || at == _observedAt) return;
        _observedAt = at;
        var quote = view.Snapshot;
        if(view.Session==MarketSession.Overnight)return; // Shared hub observations also cover time while this panel was hidden.
        var existing = _live.View(now);
        if (existing.History.Source != quote.Source) return;
        _live.Observe(new(Symbol, quote.Price, at, quote.MarketState, Source: quote.Source));
        var joined = _live.View(now);
        ChartRepairing = joined.Status is "repairing" or "waiting_history";
        ChartObserved = joined.ObservedTail.Count > 0;
        // Work on the recent tail only; do not sort ten days of history on every market update.
        var bars = joined.History.Bars.Where(b => b.Time >= at.AddDays(-2)).Concat(joined.ObservedTail)
            .GroupBy(b => b.Time).Select(g => g.Last()).OrderBy(b => b.Time).ToArray();
        var series = joined.History with { Bars = bars };
        var session = view.Session;
        _graphs[session] = IntradaySparkline.Create(series, view.IsExtended ? Quote?.Price : Quote?.PreviousClose, now, session, fitObserved:joined.Status=="observed_partial" && !joined.History.Bars.Any(b => (Meili.Core.Time.MarketClock.ToEastern(b.Time).Hour>=20 || Meili.Core.Time.MarketClock.ToEastern(b.Time).Hour<4) && IntradaySparkline.SessionDay(b.Time,MarketSession.Overnight)==IntradaySparkline.SessionDay(at,MarketSession.Overnight)));
    }
    internal void SetNightObservations(IReadOnlyList<QuoteTick> observations,DateTimeOffset now)
    {
        if(observations.Count==0)return;
        var latest=observations[^1];var day=IntradaySparkline.SessionDay(latest.Time,MarketSession.Overnight);
        var ticks=observations.Where(t=>t.Source==latest.Source&&IntradaySparkline.SessionDay(t.Time,MarketSession.Overnight)==day).ToArray();
        var history=_nightHistory;
        var hasHistory=history?.Source==latest.Source&&history.Adjustment!=PriceAdjustment.SplitDividend&&history.Bars.Any(b=>(MarketClock.ToEastern(b.Time).Hour>=20||MarketClock.ToEastern(b.Time).Hour<4)&&IntradaySparkline.SessionDay(b.Time,MarketSession.Overnight)==day);
        var bars=(hasHistory?history!.Bars.Where(b=>b.Time>=latest.Time.AddDays(-2)):[])
            .Concat(ticks.Select(t=>Bar.CloseOnly(t.Time,t.Price,double.NaN))).GroupBy(b=>b.Time).Select(g=>g.Last()).OrderBy(b=>b.Time).ToArray();
        var path=new BarSeries{Symbol=Symbol,Interval=hasHistory?history!.Interval:BarInterval.Minute1,Bars=bars,Source=latest.Source,AsOf=latest.Time};
        _graphs[MarketSession.Overnight]=IntradaySparkline.Create(path,Quote?.Price,now,MarketSession.Overnight,fitObserved:!hasHistory);
        if(Display?.Session==MarketSession.Overnight){ChartObserved=true;ChartRepairing=false;}
    }
    public BarSeries? ChartMeta{get;internal set;}
    public bool GraphFailed{get;internal set;}
    internal DateTimeOffset GraphRequested;
    public string Name=>Quote?.Name??Symbol;
    public string Price=>Display?.Snapshot is {Price:>0} q && double.IsFinite(q.Price)?(q.Price>=1e9?q.Price.ToString("0.##E+0",System.Globalization.CultureInfo.InvariantCulture):NumberDisplay.Price(q.Price)):"—";
    public string Change=>Display?.Snapshot is { } q?QuoteMovement.Percent(QuoteMovement.Values(q).Percent):"—";
    public string GraphBrushKey => Graph.Offline || GraphFailed || Graph.Points.Count < 1 || Graph.Baseline is not { } baseline
        ? "UnknownBrush" : Graph.Points[^1].Y <= baseline ? "UpBrush" : "DownBrush";
    public string BrushKey=>Display is not { } view || view.Stale(Now(), Failed)?"UnknownBrush":QuoteMovement.Values(view.Snapshot).Percent is { } p?p>=0?"UpBrush":"DownBrush":"UnknownBrush";
}

/// <summary>Visible-only quote subscriber; the existing QuotePump drives updates. No new market timer.</summary>
public sealed class QuotePanelViewModel : IDisposable
{
    public const int PageSize=8;
    public Func<DateTimeOffset> Now { get; set; } = () => DateTimeOffset.UtcNow;
    private readonly QuoteHub _hub;private readonly IMarketDataService _data;private readonly WatchlistStore _watch;private readonly SymbolContext _context;
    private readonly LocalizationService _loc;private readonly string _owner="quote-panel-"+Guid.NewGuid();
    private readonly Dictionary<string,PanelQuoteRow> _cache=new(StringComparer.OrdinalIgnoreCase);
    private CancellationTokenSource? _request;private bool _visible,_disposed;private int _generation;private DateTimeOffset _lastAutomatic;
    public MarketWorkspaceViewModel? Watchlist { get; private set; }
    public MarketWorkspaceViewModel ConnectWatchlist(SettingsStore? settings = null) =>
        Watchlist ??= new(_context, _watch, _hub, _loc, _data, settings, pageSize: PageSize);

    public event EventHandler? Changed;
    public IReadOnlyList<PanelQuoteRow> Rows{get;private set;}=[];
    public PanelQuoteRow? Selected=>Rows.FirstOrDefault(r=>r.Symbol==_context.Current)??Rows.FirstOrDefault();
    public static IReadOnlyList<MarketSession?> ChartSessions { get; } = new MarketSession?[] { null, MarketSession.PreMarket, MarketSession.Regular, MarketSession.AfterHours, MarketSession.Overnight };
    public int ChartSessionIndex { get; private set; }
    public void SelectChartSession(int index)
    {
        if(index < 0 || index >= ChartSessions.Count || index == ChartSessionIndex) return;
        ChartSessionIndex = index;
        foreach(var row in _cache.Values) row.ChartSession = ChartSessions[index];
        Notify();
    }
    public int Page{get;private set;}public int Pages{get;private set;}=1;public bool IsBusy{get;private set;}
    public string Status{get;private set;}="";
    public QuotePanelViewModel(QuoteHub hub,IMarketDataService data,WatchlistStore watch,SymbolContext context,LocalizationService loc)
    {_hub=hub;_data=data;_watch=watch;_context=context;_loc=loc;hub.Updated+=OnBatch;watch.Changed+=OnWatch;context.Changed+=OnSymbol;loc.LanguageChanged+=OnLabels;Ui.Platform.ColorsChanged+=OnLabels;}
    public async Task ActivateAsync()
    {
        if (_disposed) return;
        _visible = true;
        Watchlist?.Activate(this, watchlistVisible: true);
        Build();
        await RefreshAsync(false);
    }
    public void Deactivate(){if(_disposed)return;_visible=false;_generation++;_request?.Cancel();_hub.Unsubscribe(_owner);Watchlist?.Deactivate(this);IsBusy=false;}
    private void Notify()=>Changed?.Invoke(this,EventArgs.Empty);
    private void Build()
    {
        var watch=_watch.AllSymbols.ToList();if(!watch.Contains(_context.Current??"SPY",StringComparer.OrdinalIgnoreCase))watch.Insert(0,_context.Current??"SPY");var symbols=watch.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();Pages=Math.Max(1,(symbols.Length+PageSize-1)/PageSize);Page=Math.Clamp(Page,0,Pages-1);
        Rows=symbols.Skip(Page*PageSize).Take(PageSize).Select(s=>{if(!_cache.TryGetValue(s,out var row))_cache[s]=row=new(s) { Now = () => Now() };if(_hub.TryGetCached(s,out var q))row.Quote=q;row.ChartSession=ChartSessions[ChartSessionIndex];row.SetNightObservations(_hub.GetOvernightObservations(s),Now());return row;}).ToArray();
        foreach(var s in _cache.Keys.Where(s=>!symbols.Contains(s,StringComparer.OrdinalIgnoreCase)).ToArray())_cache.Remove(s);
        if(_visible)_hub.Subscribe(_owner,Rows.Select(r=>r.Symbol));Notify();
    }
    private void CancelRefresh(){_request?.Cancel();_generation++;IsBusy=false;}
    public async Task MoveAsync(int delta){CancelRefresh();Page+=delta;Build();await RefreshAsync(false);}
    public void Select(string symbol){if(Rows.Any(r=>r.Symbol==symbol))_context.Set(symbol);}
    private void OnSymbol(object? sender,string symbol){if(!_visible)return;if(!Rows.Any(r=>r.Symbol==symbol)){
        CancelRefresh();
        var index = _watch.AllSymbols.ToList().FindIndex(item => StringComparer.OrdinalIgnoreCase.Equals(item, symbol));
        Page = index < 0 ? 0 : index / PageSize;
        Build();
        _ = RefreshAsync(false);
    }Notify();}
    private void OnWatch(object? sender,EventArgs e){if(!_visible)return;CancelRefresh();Build();_ = RefreshAsync(false);}
    private void OnLabels(object? sender,EventArgs e)=>Ui.Platform.Run(()=>{if(_visible)Notify();});
    private void OnBatch(object? sender,QuoteBatch batch)=>Ui.Platform.Run(()=>
    {
        if(!_visible||_disposed)return;foreach(var row in Rows.Where(r=>batch.Covers(r.Symbol))){var q=batch.Find(row.Symbol);row.Failed=batch.Error is not null||q is null;if(q is not null){row.Quote=q;row.ObserveLive(Now());row.SetNightObservations(_hub.GetOvernightObservations(row.Symbol),Now());}}Notify();
        if(!IsBusy && DateTimeOffset.UtcNow-_lastAutomatic>TimeSpan.FromSeconds(Rows.Any(r=>r.ChartRepairing)?15:60))_ = RefreshAsync(false);
    });
    public async Task RefreshAsync(bool force=true)
    {
        if(!_visible||_disposed||IsBusy)return;_request?.Dispose();_request=new CancellationTokenSource(TimeSpan.FromSeconds(35));var ct=_request.Token;var generation=++_generation;
        IsBusy=true;Status="";_lastAutomatic=DateTimeOffset.UtcNow;Notify();var rows=Rows.ToArray();
        try
        {
            try{await _hub.GetQuotesAsync(rows.Select(r=>r.Symbol).ToArray(),ct);}catch(OperationCanceledException)when(ct.IsCancellationRequested){throw;}catch(Exception ex){AppLog.Warn("quote-panel","Quote refresh failed",ex);Status=_loc["QP_Retry"];}
            if (force && Watchlist is { } watchlist) await watchlist.RefreshAsync(force: true);
            using var gate=new SemaphoreSlim(2);
            await Task.WhenAll(rows.Select(async row=>
            {
                if(!force && !row.ChartRepairing && DateTimeOffset.UtcNow-row.GraphRequested<TimeSpan.FromMinutes(1))return;
                await gate.WaitAsync(ct);try
                {
                    var now=Now();var series=await _data.GetBarsAsync(new(row.Symbol,BarInterval.Minute5,now.AddDays(-10),now),ct);
                    if(ct.IsCancellationRequested||generation!=_generation||!_visible)return;
                    if(series.Interval!=BarInterval.Minute5 || !string.Equals(series.Symbol,row.Symbol,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Mismatched chart symbol");
                    row.GraphRequested=DateTimeOffset.UtcNow;row.SetGraphs(series,now);row.SetNightObservations(_hub.GetOvernightObservations(row.Symbol),now);row.ChartMeta=series with{Bars=[]};row.GraphFailed=false;Notify();
                }
                catch(OperationCanceledException)when(ct.IsCancellationRequested){throw;}
                catch(Exception ex){AppLog.Warn("quote-panel","Intraday unavailable for "+row.Symbol,ex);if(generation!=_generation||!_visible)return;row.GraphFailed=true;Status=_loc["QP_Retry"];}
                finally{gate.Release();}
            }));
        }
        catch(OperationCanceledException)when(ct.IsCancellationRequested){if(generation==_generation&&_visible)Status=_loc["QP_Retry"];}
        finally{if(generation==_generation){IsBusy=false;Notify();}}
    }
    public void Dispose(){if(_disposed)return;Deactivate();_disposed=true;_request?.Dispose();_hub.Updated-=OnBatch;_watch.Changed-=OnWatch;_context.Changed-=OnSymbol;_loc.LanguageChanged-=OnLabels;Ui.Platform.ColorsChanged-=OnLabels;}
}
