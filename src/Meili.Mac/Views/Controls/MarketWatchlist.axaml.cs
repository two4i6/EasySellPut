using Avalonia.Input;
using Avalonia.VisualTree;
using Avalonia;
using Avalonia.Interactivity;
using Avalonia.Controls;

namespace Meili.Mac.Views.Controls;

/// <summary>Shared groups, quote columns, mini charts, and visible-row history.</summary>
public partial class MarketWatchlist : UserControl
{
    public object? Owner { get; set; }
    public event EventHandler? SelectionInvoked;

    public MarketWatchlist()
    {
        InitializeComponent();
        AttachedToVisualTree += (_, _) => DesignTypography.Changed += OnTypographyChanged;
        DetachedFromVisualTree += (_, _) => DesignTypography.Changed -= OnTypographyChanged;
        WorkspaceWatchRows.LayoutUpdated += (_, _) => UpdateViewport();
        WorkspaceWatchRows.DoubleTapped += (_, _) => InvokeSelection();
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
        if (Owner is null || !IsEffectivelyVisible || DataContext is not MarketWorkspaceViewModel model) return;
        var viewport = WorkspaceWatchRows.GetVisualDescendants()
            .OfType<Avalonia.Controls.Presenters.ScrollContentPresenter>().FirstOrDefault();
        var symbols = viewport?.GetVisualDescendants().OfType<ListBoxItem>()
            .Where(item => item.TranslatePoint(default, viewport) is { } point
                && point.Y < viewport.Bounds.Height && point.Y + item.Bounds.Height > 0)
            .Select(item => item.DataContext).OfType<WorkspaceQuote>().Select(row => row.Symbol).ToArray() ?? [];
        model.SetWatchlistViewport(Owner, Bounds.Width, symbols);
    }
}
