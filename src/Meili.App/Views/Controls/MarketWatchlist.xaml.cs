using System.Windows.Input;
using System.Windows.Media;
using System.Windows;
using System.Windows.Controls;

namespace Meili.App.Views.Controls;

/// <summary>Shared groups, quote columns, mini charts, and visible-row history.</summary>
public partial class MarketWatchlist : UserControl
{
    public object? Owner { get; set; }
    public event EventHandler? SelectionInvoked;

    public MarketWatchlist()
    {
        InitializeComponent();
        Loaded += (_, _) => DesignTypography.Changed += OnTypographyChanged;
        Unloaded += (_, _) => DesignTypography.Changed -= OnTypographyChanged;
        WorkspaceWatchRows.LayoutUpdated += (_, _) => UpdateViewport();
        WorkspaceWatchRows.MouseDoubleClick += (_, _) => InvokeSelection();
        WorkspaceWatchRows.KeyUp += (_, args) =>
        {
            if (args.Key != Key.Enter) return;
            InvokeSelection();
        };
    }

    private void InvokeSelection()
    {
        if (WorkspaceWatchRows.SelectedItem is WorkspaceQuote) SelectionInvoked?.Invoke(this, EventArgs.Empty);
    }

    private void OnTypographyChanged(object? sender, EventArgs e)
    {
        if (DataContext is MarketWorkspaceViewModel model) model.RefreshWatchlistTypography();
        UpdateViewport();
    }

    private void UpdateViewport()
    {
        if (Owner is null || !IsVisible || DataContext is not MarketWorkspaceViewModel model) return;
        var viewport = FindViewport(WorkspaceWatchRows);
        var symbols = new List<string>();
        if (viewport is not null)
        {
            foreach (var row in WorkspaceWatchRows.Items.OfType<WorkspaceQuote>())
            {
                if (WorkspaceWatchRows.ItemContainerGenerator.ContainerFromItem(row) is not ListBoxItem item
                    || !viewport.IsAncestorOf(item)) continue;
                var y = item.TranslatePoint(new Point(), viewport).Y;
                if (y < viewport.ActualHeight && y + item.ActualHeight > 0) symbols.Add(row.Symbol);
            }
        }
        model.SetWatchlistViewport(Owner, ActualWidth, [.. symbols]);
    }

    private static ScrollContentPresenter? FindViewport(DependencyObject parent)
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(parent); i++)
        {
            var child = VisualTreeHelper.GetChild(parent, i);
            if (child is ScrollContentPresenter viewport) return viewport;
            if (FindViewport(child) is { } nested) return nested;
        }
        return null;
    }
}
