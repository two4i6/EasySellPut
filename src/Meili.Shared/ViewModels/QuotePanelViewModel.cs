using System.ComponentModel;
using Meili.Core.Abstractions;
using Meili.Core.Diagnostics;
using Meili.Core.Quotes;
using Meili.Core.Settings;
using Meili.Shared.Services;

namespace Meili.Shared.ViewModels;

/// <summary>Market glance uses the same watchlist and history as the workspace, with a visible selected-symbol chart.</summary>
public sealed class QuotePanelViewModel : IDisposable
{
    private readonly LocalizationService _loc;
    private WorkspaceQuote? _selected;
    private bool _active;
    private int _generation;

    public MarketWorkspaceViewModel Watchlist { get; }
    public IReadOnlyList<WorkspaceQuote> Rows => Watchlist.Rows;
    public WorkspaceQuote? Selected => _selected;
    public bool IsBusy { get; private set; }
    public string Status { get; private set; } = "";
    public event EventHandler? Changed;

    public QuotePanelViewModel(QuoteHub hub, IMarketDataService data, WatchlistStore watch, SymbolContext context, LocalizationService loc, SettingsStore? settings = null)
    {
        _loc = loc;
        Watchlist = new(context, watch, hub, loc, data, settings, showSelectedHistory: true, pageSize: 8);
    }

    public async Task ActivateAsync()
    {
        if (!_active)
        {
            _active = true;
            Watchlist.PropertyChanged += OnWatchlistChanged;
            Watchlist.Activate(this, watchlistVisible: true);
            SetSelected(Watchlist.Current);
        }
        await RefreshAsync(force: false);
    }

    public void Deactivate()
    {
        if (!_active) return;
        _active = false;
        _generation++;
        Watchlist.PropertyChanged -= OnWatchlistChanged;
        Watchlist.Deactivate(this);
        SetSelected(null);
        IsBusy = false;
    }

    public void Select(string symbol)
    {
        if (Rows.FirstOrDefault(row => row.Symbol == symbol) is { } row) Watchlist.Selection = row;
    }

    public async Task RefreshAsync(bool force = true)
    {
        if (!_active || IsBusy) return;
        var generation = _generation;
        IsBusy = true;
        Status = "";
        Changed?.Invoke(this, EventArgs.Empty);
        try { await Watchlist.RefreshAsync(force); }
        catch (Exception ex)
        {
            if (generation == _generation)
            {
                AppLog.Warn("quote-panel", "Quote refresh failed", ex);
                Status = _loc["QP_Retry"];
            }
        }
        finally
        {
            if (generation == _generation)
            {
                IsBusy = false;
                Changed?.Invoke(this, EventArgs.Empty);
            }
        }
    }

    private void OnWatchlistChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(MarketWorkspaceViewModel.Current)) SetSelected(Watchlist.Current);
    }

    private void SetSelected(WorkspaceQuote? row)
    {
        if (_selected is not null) _selected.PropertyChanged -= OnSelectedChanged;
        _selected = row;
        if (_selected is not null) _selected.PropertyChanged += OnSelectedChanged;
        Changed?.Invoke(this, EventArgs.Empty);
    }

    private void OnSelectedChanged(object? sender, PropertyChangedEventArgs e) => Changed?.Invoke(this, EventArgs.Empty);
    public void Dispose() => Deactivate();
}
