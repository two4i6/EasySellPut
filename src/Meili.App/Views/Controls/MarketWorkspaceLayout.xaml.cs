using System.Windows.Input;
using System.Windows;
using System.Windows.Controls;

namespace Meili.App.Views.Controls;

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

    public static readonly DependencyProperty TitleProperty =
        DependencyProperty.Register(nameof(Title), typeof(string), typeof(MarketWorkspaceLayout),
            new PropertyMetadata(""));
    public string Title
    {
        get => (string)GetValue(TitleProperty);
        set => SetValue(TitleProperty, value);
    }
    public static readonly DependencyProperty HelpTextProperty =
        DependencyProperty.Register(nameof(HelpText), typeof(string), typeof(MarketWorkspaceLayout),
            new PropertyMetadata(""));
    public string HelpText
    {
        get => (string)GetValue(HelpTextProperty);
        set => SetValue(HelpTextProperty, value);
    }
    public static readonly DependencyProperty WorkspaceContentProperty =
        DependencyProperty.Register(nameof(WorkspaceContent), typeof(UIElement), typeof(MarketWorkspaceLayout),
            new PropertyMetadata(null));
    public UIElement? WorkspaceContent
    {
        get => (UIElement?)GetValue(WorkspaceContentProperty);
        set => SetValue(WorkspaceContentProperty, value);
    }

    public MarketWorkspaceLayout()
    {
        InitializeComponent();
        WatchlistView.Owner = this;
        SymbolToolbar.DataContext = WorkspaceWatchlist.DataContext = WorkspaceQuote.DataContext = _model;
        Loaded += (_, _) =>
        {
            ApplyPanelPreference();
            _model.Activate(this, WorkspaceWatchlist.Visibility == Visibility.Visible);
        };
        Unloaded += (_, _) =>
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
        QuoteToggle.Visibility = UseNativeQuotePanel ? Visibility.Visible : Visibility.Collapsed;
        QuoteToggle.IsChecked = UseNativeQuotePanel && quote;
        WorkspaceWatchlist.Visibility = watchlist ? Visibility.Visible : Visibility.Collapsed;
        WorkspaceQuote.Visibility = UseNativeQuotePanel && quote ? Visibility.Visible : Visibility.Collapsed;
        WatchlistSplitter.Visibility = watchlist ? Visibility.Visible : Visibility.Collapsed;
        ResizeWatchlist(ActualWidth);
        _model.SetWatchlistVisible(this, watchlist);
    }

    private void ResizeWatchlist(double available)
    {
        if (!(WorkspaceWatchlist.Visibility == Visibility.Visible))
        {
            WatchlistColumn.MinWidth = 0;
            WatchlistColumn.Width = new GridLength(0);
            return;
        }
        var maximum = MarketWorkspaceViewModel.WatchlistWidthLimit(available, WorkspaceQuote.Visibility == Visibility.Visible);
        WatchlistColumn.MinWidth = MarketWorkspaceViewModel.MinimumWatchlistWidth;
        WatchlistColumn.MaxWidth = maximum;
        if (!_dragging)
            WatchlistColumn.Width = new GridLength(Math.Min(maximum, _model.PreferredWatchlistWidth));
    }

    private void SaveWatchlistWidth()
    {
        if (WorkspaceWatchlist.Visibility == Visibility.Visible && WatchlistColumn.Width.IsAbsolute)
            _model.SaveWatchlistWidth(WatchlistColumn.Width.Value);
    }

}
