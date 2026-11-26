using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Meili.Core.Diagnostics;
using Meili.Core.Abstractions;
using Meili.Core.Models;
using Meili.Core.Quotes;
using Meili.Core.Settings;
using Meili.Core.Time;
using Meili.Shared.Services;

namespace Meili.Shared.ViewModels;

public sealed partial class MarketWorkspaceViewModel(
    SymbolContext context, WatchlistStore watchlist, QuoteHub quotes, LocalizationService loc,
    IMarketDataService data, SettingsStore? settings = null, bool showSelectedHistory = false, int pageSize = 10) : ObservableObject
{
    private Task _historyTask = Task.CompletedTask;
    private readonly string _owner = $"market-workspace-{Guid.NewGuid()}";
    private object? _activeOwner;
    private IReadOnlyList<string> _subscribed = [];
    private CancellationTokenSource? _lifetime;
    private bool _refreshing;
    private bool _watchlistVisible;
    private int _page;
    private static readonly SemaphoreSlim HistoryGate = new(2);
    private readonly Dictionary<(string Symbol, bool Year), HistoryEntry> _history = [];
    private CancellationTokenSource? _historyLifetime;
    private string[] _visibleRows = [];
    private bool _updatingChoices;
    private sealed record HistoryEntry(DateTimeOffset RetryAfter, BarSeries? Series);

    public const double MinimumWatchlistWidth = 176;
    public const double MaximumWatchlistWidth = 900;
    public const double DividerWidth = 6;
    public const double QuoteWidth = 224;
    public double PreferredWatchlistWidth => settings?.Current.WorkspaceWatchlistWidth ?? MinimumWatchlistWidth;

    public static double WatchlistWidthLimit(double available, bool quoteVisible) =>
        Math.Clamp(available - (quoteVisible ? QuoteWidth : 0) - 520 - DividerWidth,
            MinimumWatchlistWidth, MaximumWatchlistWidth);

    public bool ShowSparkline { get; private set; }
    public bool ShowAbsolute { get; private set; }
    public bool ShowYear { get; private set; }
    public bool ShowSessionMetrics { get; private set; }
    public double NumberColumnWidth => Math.Ceiling(74 * DesignTypography.Scale);
    public IReadOnlyList<WorkspaceGroup> Groups { get; private set; } = [];
    [ObservableProperty] public partial WorkspaceGroup? Group { get; set; }
    public IReadOnlyList<WorkspaceIntradayChoice> IntradayChoices { get; private set; } = [];
    [ObservableProperty] public partial WorkspaceIntradayChoice? IntradayChoice { get; set; }
    private IntradayView View => IntradayChoice?.View ?? IntradayView.Automatic;
    private SparklineSettings _indicatorSettings = new();
    private static readonly IReadOnlyList<int> PeriodChoices = Enumerable.Range(SparklineSettings.MinimumPeriod,
        SparklineSettings.MaximumPeriod - SparklineSettings.MinimumPeriod + 1).ToArray();
    public IReadOnlyList<int> IndicatorPeriods => PeriodChoices;
    [ObservableProperty] public partial bool ShowMiniMa { get; set; }
    [ObservableProperty] public partial int MiniMaPeriod { get; set; } = 20;
    [ObservableProperty] public partial bool ShowMiniEma { get; set; } = true;
    [ObservableProperty] public partial int MiniEmaPeriod { get; set; } = 9;
    [ObservableProperty] public partial bool ShowMiniVwap { get; set; }
    [ObservableProperty] public partial string IndicatorError { get; set; } = "";
    public string MiniMaLabel => _indicatorSettings.ShowMa ? $"MA {_indicatorSettings.MaPeriod}" : "";
    public string MiniEmaLabel => _indicatorSettings.ShowEma ? $"EMA {_indicatorSettings.EmaPeriod}" : "";
    public string MiniVwapLabel => _indicatorSettings.ShowVwap ? "VWAP" : "";

    [ObservableProperty] public partial string WatchlistStatus { get; set; } = "";

    private (bool Watchlist, bool Quote) _widePanels = (true, true);
    private (bool Watchlist, bool Quote) _compactPanels;

    public ObservableCollection<string> WatchSymbols { get; } = [];
    public IReadOnlyList<WorkspaceQuote> Rows { get; private set; } = [];
    [ObservableProperty] public partial string SymbolText { get; set; } = "";
    [ObservableProperty] public partial WorkspaceQuote? Selection { get; set; }
    [ObservableProperty] public partial WorkspaceQuote? Current { get; set; }
    public bool HasWatchlist => GroupSymbols.Count > 0;
    public bool CanPage => Pages > 1;
    public int Page => _page;
    public string PageText => $"{_page + 1} / {Pages}";
    private IReadOnlyList<string> GroupSymbols => (Group?.Id is { } id ? watchlist.FindGroup(id)?.Symbols : null) ?? watchlist.AllSymbols;
    public int Pages => Math.Max(1, (GroupSymbols.Count + pageSize - 1) / pageSize);

    public void Activate(object owner, bool watchlistVisible)
    {
        if (_activeOwner == owner) return;
        if (_activeOwner is { } previousOwner) Deactivate(previousOwner);
        _activeOwner = owner;
        _watchlistVisible = watchlistVisible;
        _lifetime = new CancellationTokenSource();
        WatchlistStatus = "";
        context.Set(context.Current ?? watchlist.AllSymbols.FirstOrDefault() ?? "AAPL");
        SymbolText = context.Current!;
        context.Changed += OnSymbolChanged;
        watchlist.Changed += OnWatchlistChanged;
        loc.LanguageChanged += OnLabelsChanged;
        quotes.Updated += OnQuotesUpdated;
        if (settings is not null) settings.Saved += OnIndicatorSettingsSaved;
        UpdateIndicatorSettings(settings?.Current.WatchlistSparkline ?? _indicatorSettings);
        RebuildWatchlist();
    }

    public async Task RefreshAsync(bool force = false)
    {
        if (_lifetime is not { } lifetime) return;
        if (force)
        {
            foreach (var key in _history.Keys.ToArray())
                _history[key] = _history[key] with { RetryAfter = DateTimeOffset.MinValue };
            CancelHistory();
        }
        RefreshHistory();
        var history = _historyTask;
        try { await quotes.GetQuotesAsync(_subscribed, lifetime.Token); }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
        await history;
    }

    public void Deactivate(object owner)
    {
        if (_activeOwner != owner) return;
        _activeOwner = null;
        CancelHistory();
        _visibleRows = [];
        _lifetime?.Cancel();
        _lifetime?.Dispose();
        _lifetime = null;
        _refreshing = false;
        _subscribed = [];
        context.Changed -= OnSymbolChanged;
        watchlist.Changed -= OnWatchlistChanged;
        loc.LanguageChanged -= OnLabelsChanged;
        quotes.Updated -= OnQuotesUpdated;
        if (settings is not null) settings.Saved -= OnIndicatorSettingsSaved;
        quotes.Unsubscribe(_owner);
    }

    public (bool Watchlist, bool Quote) PanelVisibility(bool compact) => compact ? _compactPanels : _widePanels;

    public void SetPanelPreference(bool compact, bool watchlist, bool quote)
    {
        if (compact) _compactPanels = (watchlist, quote);
        else _widePanels = (watchlist, quote);
    }

    public void SetWatchlistVisible(object owner, bool visible)
    {
        if (_activeOwner != owner || _watchlistVisible == visible) return;
        _watchlistVisible = visible;
        if (!visible) SetWatchlistViewport(owner, 0, []);
        Subscribe();
    }

    [ObservableProperty] public partial string SymbolError { get; set; } = "";

    partial void OnSymbolTextChanged(string value) => SymbolError = "";

    [RelayCommand]
    private void SubmitSymbol()
    {
        if (!WatchlistStore.TryNormalizeSymbol(SymbolText, out var symbol, out _))
        {
            SymbolError = loc["Ch_InvalidSymbol"];
            return;
        }
        SymbolText = symbol;
        context.Set(symbol);
    }

    [RelayCommand(CanExecute = nameof(CanPrevious))]
    private void Previous() { _page--; BuildRows(); }

    [RelayCommand(CanExecute = nameof(CanNext))]
    private void Next() { _page++; BuildRows(); }

    private bool CanPrevious() => _page > 0;
    private bool CanNext() => _page + 1 < Pages;

    partial void OnSelectionChanged(WorkspaceQuote? value)
    {
        if (_activeOwner is not null && value is not null) context.Set(value.Symbol);
    }

    private void OnSymbolChanged(object? sender, string symbol) => UpdateSymbol(symbol);
    private void OnWatchlistChanged(object? sender, EventArgs e) => RebuildWatchlist();
    private void OnLabelsChanged(object? sender, EventArgs e)
    {
        RebuildGroups();
        RefreshQuotes();
    }
    private void OnQuotesUpdated(object? sender, QuoteBatch batch) => Ui.Platform.Run(() =>
    {
        if (_activeOwner is null) return;
        if (Current is { } current) UpdateQuote(current, batch);
        foreach (var row in Rows)
            if (row != Current) UpdateQuote(row, batch);
        RefreshHistory();
    });

    private void UpdateSymbol(string symbol)
    {
        SymbolText = symbol;
        SelectCurrent();
        Subscribe();
        RefreshHistory();
    }

    private void SelectCurrent()
    {
        var symbol = context.Current;
        Selection = Rows.FirstOrDefault(row => row.Symbol == symbol);
        Current = Selection ?? (symbol is null ? null : Current?.Symbol == symbol ? Current : CreateQuote(symbol));
    }

    private void RebuildWatchlist()
    {
        WatchSymbols.Clear();
        foreach (var symbol in watchlist.AllSymbols) WatchSymbols.Add(symbol);
        RebuildGroups();
        foreach (var key in _history.Keys.Where(key => !WatchSymbols.Contains(key.Symbol)).ToArray()) _history.Remove(key);
        _page = Math.Min(_page, Pages - 1);
        BuildRows();
    }

    private void BuildRows()
    {
        CancelHistory();
        _visibleRows = [];
        Rows = GroupSymbols.Skip(_page * pageSize).Take(pageSize).Select(CreateQuote).ToArray();
        OnPropertyChanged(nameof(Rows));
        SelectCurrent();
        OnPropertyChanged(nameof(PageText));
        OnPropertyChanged(nameof(CanPage));
        OnPropertyChanged(nameof(HasWatchlist));
        PreviousCommand.NotifyCanExecuteChanged();
        NextCommand.NotifyCanExecuteChanged();
        Subscribe();
        RefreshHistory();
    }

    private WorkspaceQuote CreateQuote(string symbol)
    {
        var row = new WorkspaceQuote(symbol, loc);
        row.Refresh(quotes.TryGetCached(symbol, out var quote) ? quote : null, false);
        ApplyHistory(row, DateTimeOffset.UtcNow);
        return row;
    }

    partial void OnGroupChanged(WorkspaceGroup? value)
    {
        if (_updatingChoices || value is null) return;
        _page = 0;
        BuildRows();
    }

    partial void OnIntradayChoiceChanged(WorkspaceIntradayChoice? value)
    {
        if (!_updatingChoices && value is not null) ApplyCurrentGraphs();
    }

    [RelayCommand]
    private void ApplyMiniIndicators()
    {
        var previous = _indicatorSettings;
        var next = new SparklineSettings(ShowMiniMa, MiniMaPeriod, ShowMiniEma, MiniEmaPeriod, ShowMiniVwap).Normalized();
        try
        {
            if (settings is not null && next != previous) settings.Update(value => value.WatchlistSparkline = next);
            UpdateIndicatorSettings(next);
            IndicatorError = "";
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            if (settings is not null) settings.Current.WatchlistSparkline = previous;
            IndicatorError = loc["Workspace_IndicatorSaveFailed"];
            AppLog.Warn("market-workspace", "Could not persist mini chart indicators", ex);
        }
    }

    private void OnIndicatorSettingsSaved(object? sender, AppSettings value) => Ui.Platform.Run(() =>
    {
        if (_activeOwner is not null && settings is not null && _indicatorSettings != settings.Current.WatchlistSparkline)
            UpdateIndicatorSettings(settings.Current.WatchlistSparkline);
    });

    private void UpdateIndicatorSettings(SparklineSettings value)
    {
        ShowMiniMa = value.ShowMa;
        MiniMaPeriod = value.MaPeriod;
        ShowMiniEma = value.ShowEma;
        MiniEmaPeriod = value.EmaPeriod;
        ShowMiniVwap = value.ShowVwap;
        if (value == _indicatorSettings) return;
        _indicatorSettings = value;
        OnPropertyChanged(nameof(MiniMaLabel));
        OnPropertyChanged(nameof(MiniEmaLabel));
        OnPropertyChanged(nameof(MiniVwapLabel));
        ApplyCurrentGraphs();
    }

    private void ApplyCurrentGraphs()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var row in Rows) ApplyHistory(row, now);
        if (Current is { } current && !Rows.Contains(current)) ApplyHistory(current, now);
    }

    private void RebuildGroups()
    {
        var id = Group?.Id;
        var view = View;
        _updatingChoices = true;
        try
        {
            Groups = [new WorkspaceGroup(null, loc["Workspace_AllSymbols"]), ..watchlist.Groups
                .Select(group => new WorkspaceGroup(group.Id, string.IsNullOrEmpty(group.Name) ? loc["Wl_DefaultGroup"] : group.Name))];
            OnPropertyChanged(nameof(Groups));
            Group = Groups.FirstOrDefault(group => group.Id == id) ?? Groups[0];
            IntradayChoices =
            [
                new(IntradayView.Automatic, loc["Workspace_AutoSession"]),
                new(IntradayView.Regular, loc["Workspace_RegularSession"]),
                new(IntradayView.PreMarket, loc["Quote_Pre"]),
                new(IntradayView.AfterHours, loc["Quote_Post"])
            ];
            OnPropertyChanged(nameof(IntradayChoices));
            IntradayChoice = IntradayChoices.First(choice => choice.View == view);
        }
        finally { _updatingChoices = false; }
    }

    public void SaveWatchlistWidth(double width)
    {
        if (settings is null) return;
        var next = (int)Math.Round(Math.Clamp(width, MinimumWatchlistWidth, MaximumWatchlistWidth));
        var previous = settings.Current.WorkspaceWatchlistWidth;
        if (next == previous) return;
        try
        {
            settings.Update(value => value.WorkspaceWatchlistWidth = next);
            WatchlistStatus = "";
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            settings.Current.WorkspaceWatchlistWidth = previous;
            WatchlistStatus = loc["Workspace_WidthSaveFailed"];
            AppLog.Warn("market-workspace", "Could not persist watchlist width", ex);
        }
    }

    public void SetWatchlistViewport(object owner, double width, string[] symbols)
    {
        if (_activeOwner != owner) return;
        var extra = DesignTypography.Scale - 1;
        var spark = width >= 322 + 160 * extra;
        var absolute = width >= 435 + 230 * extra;
        var year = width >= 550 + 300 * extra;
        var metrics = width >= 690 + 370 * extra;
        var columnsChanged = absolute != ShowAbsolute || metrics != ShowSessionMetrics;
        var historyChanged = spark != ShowSparkline || year != ShowYear;
        if (!historyChanged && !columnsChanged && _visibleRows.SequenceEqual(symbols)) return;
        if (historyChanged || columnsChanged)
        {
            ShowSparkline = spark;
            ShowAbsolute = absolute;
            ShowYear = year;
            ShowSessionMetrics = metrics;
            OnPropertyChanged(nameof(ShowSparkline));
            OnPropertyChanged(nameof(ShowAbsolute));
            OnPropertyChanged(nameof(ShowYear));
            OnPropertyChanged(nameof(ShowSessionMetrics));
            OnPropertyChanged(nameof(NumberColumnWidth));
        }
        if (historyChanged || !_visibleRows.SequenceEqual(symbols))
        {
            CancelHistory();
            _visibleRows = symbols;
        }
        RefreshHistory();
    }

    public void RefreshWatchlistTypography() => OnPropertyChanged(nameof(NumberColumnWidth));

    private void CancelHistory()
    {
        var request = _historyLifetime;
        _historyLifetime = null;
        request?.Cancel();
    }

    private void RefreshHistory()
    {
        if (_historyLifetime is not null || _activeOwner is null) return;
        var visible = _watchlistVisible && ShowSparkline ? _visibleRows : [];
        var selected = showSelectedHistory ? Current : null;
        if (visible.Length == 0 && selected is null) return;
        var now = DateTimeOffset.UtcNow;
        var candidates = visible.SelectMany(symbol => ShowYear
                ? new[] { (Symbol: symbol, Year: false), (Symbol: symbol, Year: true) }
                : [(Symbol: symbol, Year: false)]);
        if (selected is not null) candidates = candidates.Prepend((selected.Symbol, false)).Distinct();
        var wanted = candidates.Where(key => !_history.TryGetValue(key, out var item) || item.RetryAfter <= now).ToArray();
        if (wanted.Length == 0) return;
        var request = new CancellationTokenSource(TimeSpan.FromSeconds(45));
        _historyLifetime = request;
        _historyTask = LoadHistoryAsync(wanted, now, request);
    }

    private async Task LoadHistoryAsync((string Symbol, bool Year)[] wanted, DateTimeOffset now, CancellationTokenSource request)
    {
        var ct = request.Token;
        var yearStart = new DateTimeOffset(now.Year, 1, 1, 0, 0, 0, TimeSpan.Zero);
        try
        {
            await Task.WhenAll(wanted.Select(async key =>
            {
                await HistoryGate.WaitAsync(ct);
                try
                {
                    var series = key.Year
                        ? await data.GetBarsAsync(new BarRequest(key.Symbol, BarInterval.Day1, yearStart.AddDays(-14)), ct)
                        : await IntradaySparkline.LoadBarsAsync(data, key.Symbol, now, ct);
                    if (!ReferenceEquals(request, _historyLifetime) || ct.IsCancellationRequested) return;
                    if (key.Year && (series.Interval != BarInterval.Day1 ||
                        !string.Equals(series.Symbol, key.Symbol, StringComparison.OrdinalIgnoreCase)))
                        throw new InvalidDataException("Mismatched daily watchlist bars");
                    _history[key] = new(now.AddMinutes(key.Year ? 30 : 1), series);
                    var row = Current?.Symbol == key.Symbol ? Current : Rows.FirstOrDefault(row => row.Symbol == key.Symbol);
                    if (row is not null) ApplyHistory(row, now);
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
                catch (Exception ex)
                {
                    if (!ReferenceEquals(request, _historyLifetime) || ct.IsCancellationRequested) return;
                    AppLog.Warn("market-workspace", $"Watchlist history unavailable for {key.Symbol}", ex);
                    _history[key] = new(now.AddMinutes(1), _history.GetValueOrDefault(key)?.Series);
                }
                finally { HistoryGate.Release(); }
            }));
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        finally
        {
            if (ReferenceEquals(request, _historyLifetime))
            {
                _historyLifetime = null;
                if (!ct.IsCancellationRequested) RefreshHistory();
            }
            request.Dispose();
        }
    }

    private void ApplyHistory(WorkspaceQuote row, DateTimeOffset now)
    {
        if (_history.GetValueOrDefault((row.Symbol, false))?.Series is { } bars)
            row.SetSparkline(bars, now, View, _indicatorSettings);
        if (_history.GetValueOrDefault((row.Symbol, true))?.Series is { } daily)
            row.SetYear(daily, now);
    }

    private void Subscribe()
    {
        if (_lifetime is null) return;
        var symbols = _watchlistVisible ? Rows.Select(row => row.Symbol) : [];
        var subscribed = (Current is { } current ? symbols.Append(current.Symbol) : symbols)
            .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (_subscribed.SequenceEqual(subscribed)) return;
        _subscribed = subscribed;
        quotes.Subscribe(_owner, subscribed);
        if (!_refreshing) _ = RefreshAsync(_lifetime.Token);
    }

    private async Task RefreshAsync(CancellationToken ct)
    {
        _refreshing = true;
        try
        {
            IReadOnlyList<string> requested;
            do
            {
                requested = _subscribed;
                try { await quotes.GetQuotesAsync(requested, ct); }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { return; }
                catch (Exception ex) { AppLog.Warn("market-workspace", "Quote refresh failed", ex); }
            } while (!ct.IsCancellationRequested && requested != _subscribed);
        }
        finally
        {
            if (!ct.IsCancellationRequested) _refreshing = false;
        }
    }

    private void RefreshQuotes()
    {
        if (SymbolError.Length > 0) SymbolError = loc["Ch_InvalidSymbol"];
        Current?.Relabel();
        foreach (var row in Rows)
            if (row != Current) row.Relabel();
    }

    private static void UpdateQuote(WorkspaceQuote row, QuoteBatch batch)
    {
        if (!batch.Covers(row.Symbol)) return;
        var quote = batch.Find(row.Symbol);
        row.Refresh(quote ?? row.Quote, quote is null || batch.Error is not null);
    }
}

public sealed record WorkspaceGroup(string? Id, string Name);
public sealed record WorkspaceIntradayChoice(IntradayView View, string Name);

public sealed partial class WorkspaceQuote(string symbol, LocalizationService loc) : ObservableObject
{
    public string Symbol { get; } = symbol;
    public Quote? Quote { get; private set; }
    private bool _failed;
    [ObservableProperty] public partial IntradaySparkline Sparkline { get; private set; } = IntradaySparkline.Empty;
    private BarSeries? _sparkSource;
    private BarSeries? _dailySource;
    private DateTimeOffset? _dailyTime;
    private double? _yearReturn;
    public bool HasSparkline => Sparkline.Points.Count >= 2;
    public string SparklineCaption => Sparkline.Day is { } day ? $"{day:MM-dd} · {Sparkline.SessionLabel(loc)}" : "";
    public bool SparklineUp => HasSparkline && !Sparkline.Offline && Sparkline.Points[^1].Y < (Sparkline.Baseline ?? Sparkline.Points[0].Y);
    public bool SparklineDown => HasSparkline && !Sparkline.Offline && Sparkline.Points[^1].Y > (Sparkline.Baseline ?? Sparkline.Points[0].Y);
    public string SparklineTip => HasSparkline && _sparkSource is { } bars
        ? $"{Sparkline.Day:yyyy-MM-dd} · {Sparkline.SessionLabel(loc)} · {loc["QP_Intraday"]}\n{FreshnessText.SourceAndTiming(bars, loc, DateTimeOffset.UtcNow)}"
            + (bars.OfflineCache ? $" · {loc["Mb_Stale"]}" : "")
            + (Sparkline.VwapDistance is { } distance ? $"\n{loc["Workspace_VwapDistance"]} {QuoteMovement.Percent(distance * 100)}" : "")
            + $"\n{loc["Workspace_Rvol"]} {RelativeVolume} · {loc["Workspace_RangePosition"]} {RangePosition}"
        : loc["QP_NoChart"];
    public string VwapDistanceLabel => Sparkline.VwapDistance is { } distance ? $"VWAP {distance * 100:+0.0;-0.0;0.0}%" : "";
    public string RelativeVolume => Sparkline.RelativeVolume is { } volume ? $"{volume:0.00}×" : NumberDisplay.Empty;
    public string RangePosition => HasRangePosition ? $"{RangePercent:0}%" : NumberDisplay.Empty;
    public bool HasRangePosition => Sparkline.RangePosition is not null;
    public double RangePercent => Sparkline.RangePosition.GetValueOrDefault() * 100;
    public string RelativeVolumeTip => $"{loc["Workspace_RvolHelp"]}\n{SparklineTip}";
    public string RangePositionTip => $"{loc["Workspace_RangeHelp"]}\n{SparklineTip}";
    public string Year => QuoteMovement.Percent(_yearReturn);
    public bool IsYearUp => _yearReturn is >= 0;
    public bool IsYearDown => _yearReturn is < 0;
    public string YearTip => _dailySource is { } bars && _dailyTime is { } time
        ? $"{loc["Workspace_YtdBasis"]} · {time:yyyy-MM-dd}\n{FreshnessText.SourceAndTiming(bars, loc, DateTimeOffset.UtcNow)}"
            + (bars.OfflineCache ? $" · {loc["Mb_Stale"]}" : "")
        : loc["Workspace_YtdBasis"];
    public string Absolute => Quote is { } quote && QuoteMovement.Values(quote).Change is { } change
        ? NumberDisplay.SignedChange(change, quote.Price) : NumberDisplay.Empty;
    private MarketSession? ExtendedSession
    {
        get
        {
            if (Quote?.ExtendedTime is { } time)
            {
                var eastern = MarketClock.ToEastern(time).TimeOfDay;
                var session = MarketClock.ClassifyUsSession(eastern);
                if (session is MarketSession.PreMarket or MarketSession.AfterHours) return session;
                if (eastern == MarketClock.UsSessionBounds(MarketSession.AfterHours).End) return MarketSession.AfterHours;
            }
            return Quote?.MarketState switch
            {
                MarketState.PreMarket => MarketSession.PreMarket,
                MarketState.AfterHours => MarketSession.AfterHours,
                _ => null
            };
        }
    }
    public bool HasExtended => ExtendedSession is not null && Quote is { ExtendedPrice: > 0 } quote
        && double.IsFinite(quote.ExtendedPrice.Value);
    public string ExtendedLabel => HasExtended ? loc[ExtendedSession == MarketSession.PreMarket ? "Quote_Pre" : "Quote_Post"] : "";
    public string ExtendedPrice => HasExtended ? NumberDisplay.Price(Quote?.ExtendedPrice) : "";
    public string ExtendedChange => HasExtended ? QuoteMovement.Percent(Quote?.ExtendedChangePercent) : "";

    private bool HeroExtended => HasExtended && (ExtendedSession == Sparkline.Session ||
        !HasSparkline && Quote?.MarketState is MarketState.PreMarket or MarketState.AfterHours);
    public string HeroPrice => HeroExtended ? ExtendedPrice : Price;
    public string HeroChange
    {
        get
        {
            if (!HeroExtended) return $"{(Absolute == NumberDisplay.Empty ? "" : Absolute + "  ")}{Change}";
            var amount = Quote?.ExtendedChange;
            var signed = amount is { } change && double.IsFinite(change) ? NumberDisplay.SignedChange(change, Quote!.ExtendedPrice!.Value) + "  " : "";
            return signed + ExtendedChange;
        }
    }
    public string HeroBrushKey => HeroExtended
        ? _failed || Quote?.ExtendedChangePercent is not { } value ? "UnknownBrush" : value >= 0 ? "UpBrush" : "DownBrush"
        : IsUp ? "UpBrush" : IsDown ? "DownBrush" : "UnknownBrush";
    public string HeroSource => HeroExtended ? $"{ExtendedLabel} · {Quote!.Currency} · {FreshnessText.SourceAndTiming(Quote with { AsOf = Quote.ExtendedTime }, loc, DateTimeOffset.UtcNow)}"
        + (_failed ? $" · {loc["Mb_Stale"]}" : "") : Source.Replace('\n', ' ');
    public string HeroTimestamp => HeroExtended ? FreshnessText.AsOf(Quote?.ExtendedTime, loc) : Timestamp;
    public string HeroReference => HeroExtended ? $"{loc["Workspace_RegularReference"]}  {Price} · {Timestamp}" : Extended;

    public string Name => Quote?.Name is { Length: > 0 } name && name != Symbol ? name : "";
    public string Price => Quote is { Price: > 0 } quote ? NumberDisplay.Price(quote.Price) : NumberDisplay.Empty;
    public string Change => QuoteMovement.Percent(Quote is { } quote ? QuoteMovement.Values(quote).Percent : null);
    public string Open => NumberDisplay.Price(Quote?.Open);
    public string High => NumberDisplay.Price(Quote?.High);
    public string Low => NumberDisplay.Price(Quote?.Low);
    public string PreviousClose => NumberDisplay.Price(Quote?.PreviousClose);
    public string Volume => loc.Amount(Quote?.Volume);
    public string Source => Quote is { } quote
        ? $"{loc["Mb_Regular"]} · {quote.Currency}\n{FreshnessText.SourceAndTiming(quote, loc, DateTimeOffset.UtcNow)}"
            + (_failed ? $" · {loc["Mb_Stale"]}" : "")
        : loc["Mb_Unavailable"];
    public string Timestamp => Quote is { } quote ? FreshnessText.AsOf(quote.AsOf, loc) : "";
    public string Extended => HasExtended
        ? $"{ExtendedLabel}  {ExtendedPrice}  {ExtendedChange}\n{FreshnessText.AsOf(Quote?.ExtendedTime, loc)}"
        : "";
    private double? Movement => !_failed && Quote is { } quote && QuoteStaleness.Check(quote, DateTimeOffset.UtcNow) == StaleReason.None
        ? QuoteMovement.Values(quote).Percent : null;
    public bool IsUp => Movement is >= 0;
    public bool IsDown => Movement is < 0;

    internal void SetSparkline(BarSeries bars, DateTimeOffset now, IntradayView view, SparklineSettings indicators)
    {
        _sparkSource = bars with { Bars = [] };
        Sparkline = IntradaySparkline.ForQuote(bars, Quote, now, view, indicators);
        Relabel();
    }

    internal void SetYear(BarSeries daily, DateTimeOffset now)
    {
        _dailySource = daily with { Bars = [] };
        var year = now.Year;
        // Use closes from one split-adjusted series, and require the prior December for the baseline.
        var bars = daily.Adjustment == PriceAdjustment.Split
            ? daily.Bars.Where(bar => bar.Time <= now && double.IsFinite(bar.Close) && bar.Close > 0).OrderBy(bar => bar.Time).ToArray()
            : [];
        var previous = bars.LastOrDefault(bar => bar.Time.Year == year - 1 && bar.Time.Month == 12 && bar.Time.Day >= 19);
        var latest = bars.LastOrDefault(bar => bar.Time.Year == year);
        _dailyTime = latest?.Time;
        _yearReturn = previous is not null && latest is not null ? (latest.Close / previous.Close - 1) * 100 : null;
        OnPropertyChanged(nameof(Year));
        OnPropertyChanged(nameof(YearTip));
        OnPropertyChanged(nameof(IsYearUp));
        OnPropertyChanged(nameof(IsYearDown));
    }

    internal void Refresh(Quote? quote, bool failed)
    {
        Quote = quote;
        _failed = failed;
        Relabel();
    }

    internal void Relabel() => OnPropertyChanged(string.Empty);
}
