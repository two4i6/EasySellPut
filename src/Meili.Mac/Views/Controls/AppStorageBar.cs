using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Data;
using Avalonia.Layout;
using Meili.Shared.Services;
namespace Meili.Mac.Views.Controls;

/// <summary>Reusable proportional storage breakdown with a text legend; never implies disk capacity or free space.</summary>
public sealed class AppStorageBar : StackPanel
{
    public static readonly StyledProperty<IReadOnlyList<StorageSegmentView>> SegmentsProperty = AvaloniaProperty.Register<AppStorageBar, IReadOnlyList<StorageSegmentView>>(nameof(Segments), []);
    public IReadOnlyList<StorageSegmentView> Segments { get => GetValue(SegmentsProperty); set => SetValue(SegmentsProperty, value); }
    public AppStorageBar()
    {
        Spacing = DesignTokens.SpaceSM;
        PropertyChanged += (_, e) => { if (e.Property == SegmentsProperty) Rebuild(); };
        Rebuild();
    }
    private void Rebuild()
    {
        Children.Clear();
        var columns = new Grid();
        var track = new Border { Height = DesignTokens.StorageBarHeight, CornerRadius = new(DesignTokens.ControlRadius), ClipToBounds = true, Child = columns };
        track[!BackgroundProperty] = track.GetResourceObservable("ControlFillColorSecondaryBrush").ToBinding();
        var legend = new WrapPanel();
        foreach (var item in Segments)
        {
            if (item.Fraction > 0)
            {
                columns.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(item.Fraction, GridUnitType.Star)));
                var segment = new Border(); Grid.SetColumn(segment, columns.ColumnDefinitions.Count - 1);
                segment[!BackgroundProperty] = segment.GetResourceObservable(item.BrushKey).ToBinding();
                ToolTip.SetTip(segment, item.Description); AutomationProperties.SetName(segment, item.Description);
                columns.Children.Add(segment);
            }
            var dot = new Border { Width = DesignTokens.SpaceSM, Height = DesignTokens.SpaceSM, CornerRadius = new(DesignTokens.SpaceSM), VerticalAlignment = VerticalAlignment.Center };
            dot[!BackgroundProperty] = dot.GetResourceObservable(item.BrushKey).ToBinding();
            var label = new TextBlock { Text = item.Description, FontSize = DesignTokens.CaptionFontSize, VerticalAlignment = VerticalAlignment.Center };
            label[!TextBlock.ForegroundProperty] = label.GetResourceObservable("TextFillColorSecondaryBrush").ToBinding();
            legend.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = DesignTokens.SpaceXS, Margin = new(0, 0, DesignTokens.SpaceLG, DesignTokens.SpaceXS), Children = { dot, label } });
        }
        Children.Add(track); Children.Add(legend);
    }
}
