using Avalonia.Input;
using Avalonia;
using Avalonia.Interactivity;
using Avalonia.Controls;

namespace Meili.Mac.Views.Controls;

/// <summary>The shared symbol, watchlist and quote frame for market detail pages.</summary>
public partial class MarketWorkspaceLayout : UserControl
{
    private const double WideLayoutWidth = 1130;
    private readonly MarketWorkspaceViewModel _model = AppServices.Get<MarketWorkspaceViewModel>();
    internal MarketWorkspaceViewModel Model => _model;
    public bool UseNativeQuotePanel { get; set; } = true;
    private bool? _compact;
    private bool _dragging;
    private ColumnDefinition WatchlistColumn => WorkspaceBody.ColumnDefinitions[0];

    public static readonly StyledProperty<string> TitleProperty =
        AvaloniaProperty.Register<MarketWorkspaceLayout, string>(nameof(Title), "");
    public string Title
    {
        get => GetValue(TitleProperty);
        set => SetValue(TitleProperty, value);
    }
    public static readonly StyledProperty<string> HelpTextProperty =
        AvaloniaProperty.Register<MarketWorkspaceLayout, string>(nameof(HelpText), "");
    public string HelpText
    {
        get => GetValue(HelpTextProperty);
        set => SetValue(HelpTextProperty, value);
    }
    public static readonly StyledProperty<Control?> WorkspaceContentProperty =
        AvaloniaProperty.Register<MarketWorkspaceLayout, Control?>(nameof(WorkspaceContent), null);
    public Control? WorkspaceContent
    {
        get => GetValue(WorkspaceContentProperty);
        set => SetValue(WorkspaceContentProperty, value);
    }

    public MarketWorkspaceLayout()
    {
        InitializeComponent();
        WatchlistView.Owner = this;
        SymbolToolbar.DataContext = WorkspaceWatchlist.DataContext = WorkspaceQuote.DataContext = _model;
        AttachedToVisualTree += (_, _) =>
        {
            ApplyPanelPreference();
            _model.Activate(this, WorkspaceWatchlist.IsVisible);
        };
        DetachedFromVisualTree += (_, _) =>
        {
            _dragging = false;
            _model.Deactivate(this);
        };
        WatchlistSplitter.DragStarted += (_, _) => _dragging = true;
        WatchlistSplitter.DragCompleted += (_, _) =>
        {
            _dragging = false;
            SaveWatchlistWidth();
        };
        WatchlistSplitter.KeyUp += (_, e) =>
        {
            if (e.Key is Key.Left or Key.Right) SaveWatchlistWidth();
        };
        SizeChanged += (_, e) => UpdateWidth(e.NewSize.Width);
    }

    private void OnWatchlistToggle(object? sender, RoutedEventArgs e)
    {
        var watchlist = WatchlistToggle.IsChecked == true;
        var quote = UseNativeQuotePanel
            ? QuoteToggle.IsChecked == true && (!watchlist || _compact != true)
            : _model.PanelVisibility(_compact != false).Quote;
        SavePanelPreference(watchlist, quote);
    }

    private void OnQuoteToggle(object? sender, RoutedEventArgs e)
    {
        var quote = QuoteToggle.IsChecked == true;
        SavePanelPreference(WatchlistToggle.IsChecked == true && (!quote || _compact != true), quote);
    }

    private void UpdateWidth(double width)
    {
        var compact = width < WideLayoutWidth;
        if (_compact == compact)
        {
            ResizeWatchlist(width);
            return;
        }
        _compact = compact;
        ApplyPanelPreference();
    }

    private void ApplyPanelPreference()
    {
        var (watchlist, quote) = _model.PanelVisibility(_compact != false);
        SetPanels(watchlist, quote);
    }

    private void SavePanelPreference(bool watchlist, bool quote)
    {
        _model.SetPanelPreference(_compact != false, watchlist, quote);
        SetPanels(watchlist, quote);
    }

    private void SetPanels(bool watchlist, bool quote)
    {
        WatchlistToggle.IsChecked = watchlist;
        QuoteToggle.IsVisible = UseNativeQuotePanel;
        QuoteToggle.IsChecked = UseNativeQuotePanel && quote;
        WorkspaceWatchlist.IsVisible = watchlist;
        WorkspaceQuote.IsVisible = UseNativeQuotePanel && quote;
        WatchlistSplitter.IsVisible = watchlist;
        ResizeWatchlist(Bounds.Width);
        _model.SetWatchlistVisible(this, watchlist);
    }

    private void ResizeWatchlist(double available)
    {
        if (!(WorkspaceWatchlist.IsVisible))
        {
            WatchlistColumn.MinWidth = 0;
            WatchlistColumn.Width = new GridLength(0);
            return;
        }
        var maximum = MarketWorkspaceViewModel.WatchlistWidthLimit(available, WorkspaceQuote.IsVisible);
        WatchlistColumn.MinWidth = MarketWorkspaceViewModel.MinimumWatchlistWidth;
        WatchlistColumn.MaxWidth = maximum;
        if (!_dragging)
            WatchlistColumn.Width = new GridLength(Math.Min(maximum, _model.PreferredWatchlistWidth));
    }

    private void SaveWatchlistWidth()
    {
        if (WorkspaceWatchlist.IsVisible && WatchlistColumn.Width.IsAbsolute)
            _model.SaveWatchlistWidth(WatchlistColumn.Width.Value);
    }

}
