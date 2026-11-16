using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using Meili.Shared.Services;
namespace Meili.App.Views.Controls;

/// <summary>Reusable proportional storage breakdown with a text legend; never implies disk capacity or free space.</summary>
public sealed class AppStorageBar : StackPanel
{
    public static readonly DependencyProperty SegmentsProperty = DependencyProperty.Register(nameof(Segments), typeof(IReadOnlyList<StorageSegmentView>), typeof(AppStorageBar), new PropertyMetadata(null, (d, _) => ((AppStorageBar)d).Rebuild()));
    public IReadOnlyList<StorageSegmentView>? Segments { get => (IReadOnlyList<StorageSegmentView>?)GetValue(SegmentsProperty); set => SetValue(SegmentsProperty, value); }
    public AppStorageBar() => Rebuild();
    private void Rebuild()
    {
        Children.Clear(); var columns = new Grid();
        var track = new Border { Height = DesignTokens.StorageBarHeight, CornerRadius = new(DesignTokens.ControlRadius), ClipToBounds = true, Child = columns, Margin = new(0, 0, 0, DesignTokens.SpaceSM) };
        track.SetResourceReference(BackgroundProperty, "ControlFillColorSecondaryBrush");
        var legend = new WrapPanel();
        foreach (var item in Segments ?? [])
        {
            if (item.Fraction > 0)
            {
                columns.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(item.Fraction, GridUnitType.Star) });
                var segment = new Border { ToolTip = item.Description }; Grid.SetColumn(segment, columns.ColumnDefinitions.Count - 1);
                segment.SetResourceReference(BackgroundProperty, item.BrushKey); AutomationProperties.SetName(segment, item.Description); columns.Children.Add(segment);
            }
            var dot = new Border { Width = DesignTokens.SpaceSM, Height = DesignTokens.SpaceSM, CornerRadius = new(DesignTokens.SpaceSM), VerticalAlignment = VerticalAlignment.Center, Margin = new(0, 0, DesignTokens.SpaceXS, 0) };
            dot.SetResourceReference(BackgroundProperty, item.BrushKey);
            var label = new TextBlock { Text = item.Description, FontSize = DesignTokens.CaptionFontSize, VerticalAlignment = VerticalAlignment.Center };
            label.SetResourceReference(TextBlock.ForegroundProperty, "TextFillColorSecondaryBrush");
            var row = new StackPanel { Orientation = Orientation.Horizontal, Margin = new(0, 0, DesignTokens.SpaceLG, DesignTokens.SpaceXS) }; row.Children.Add(dot); row.Children.Add(label); legend.Children.Add(row);
        }
        Children.Add(track); Children.Add(legend);
    }
}
