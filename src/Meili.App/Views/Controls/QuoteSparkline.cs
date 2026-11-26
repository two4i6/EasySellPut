using System.Windows;
using System.Windows.Media;
using Meili.Shared.Services;

namespace Meili.App.Views.Controls;

public sealed class QuoteSparkline : FrameworkElement
{
    public static readonly DependencyProperty DataProperty =
        DependencyProperty.Register(nameof(Data), typeof(IntradaySparkline), typeof(QuoteSparkline),
            new FrameworkPropertyMetadata(IntradaySparkline.Empty, FrameworkPropertyMetadataOptions.AffectsRender));
    public static readonly DependencyProperty LineBrushProperty =
        DependencyProperty.Register(nameof(LineBrush), typeof(Brush), typeof(QuoteSparkline),
            new FrameworkPropertyMetadata(Brushes.Gray, FrameworkPropertyMetadataOptions.AffectsRender));
    public static readonly DependencyProperty MaBrushProperty =
        DependencyProperty.Register(nameof(MaBrush), typeof(Brush), typeof(QuoteSparkline),
            new FrameworkPropertyMetadata(null, FrameworkPropertyMetadataOptions.AffectsRender));
    public static readonly DependencyProperty EmaBrushProperty =
        DependencyProperty.Register(nameof(EmaBrush), typeof(Brush), typeof(QuoteSparkline),
            new FrameworkPropertyMetadata(null, FrameworkPropertyMetadataOptions.AffectsRender));
    public static readonly DependencyProperty VwapBrushProperty =
        DependencyProperty.Register(nameof(VwapBrush), typeof(Brush), typeof(QuoteSparkline),
            new FrameworkPropertyMetadata(null, FrameworkPropertyMetadataOptions.AffectsRender));

    public QuoteSparkline()
    {
        SetResourceReference(MaBrushProperty, "SparklineMaBrush");
        SetResourceReference(EmaBrushProperty, "SparklineEmaBrush");
        SetResourceReference(VwapBrushProperty, "SparklineVwapBrush");
    }

    public IntradaySparkline Data { get => (IntradaySparkline)GetValue(DataProperty); set => SetValue(DataProperty, value); }
    public Brush LineBrush { get => (Brush)GetValue(LineBrushProperty); set => SetValue(LineBrushProperty, value); }
    public Brush? MaBrush { get => (Brush?)GetValue(MaBrushProperty); set => SetValue(MaBrushProperty, value); }
    public Brush? EmaBrush { get => (Brush?)GetValue(EmaBrushProperty); set => SetValue(EmaBrushProperty, value); }
    public Brush? VwapBrush { get => (Brush?)GetValue(VwapBrushProperty); set => SetValue(VwapBrushProperty, value); }

    protected override void OnRender(DrawingContext context)
    {
        base.OnRender(context);
        var width = ActualWidth;
        var height = ActualHeight;
        if (Data.Points.Count < 2 || width <= 0 || height <= 0) return;

        if (Data.Baseline is { } baseline)
            context.DrawLine(new Pen(LineBrush, .6) { DashStyle = DashStyles.Dash }, new Point(0, baseline * height), new Point(width, baseline * height));
        if (Data.Ma.Count > 1) DrawSeries(Data.Ma, new Pen(MaBrush ?? Brushes.SteelBlue, 1.2) { DashStyle = DashStyles.Dash });
        if (Data.Ema.Count > 1) DrawSeries(Data.Ema, new Pen(EmaBrush ?? Brushes.MediumPurple, 1.2));
        if (Data.Vwap.Count > 1) DrawSeries(Data.Vwap, new Pen(VwapBrush ?? Brushes.DarkOrange, 1.35) { DashStyle = DashStyles.DashDot });
        DrawSeries(Data.Points, new Pen(LineBrush, 1.7));
        context.DrawEllipse(LineBrush, null, Project(Data.Points[^1]), 2, 2);

        Point Project(SparkPoint point) => new(point.X * width, point.Y * height);

        void DrawSeries(IReadOnlyList<SparkPoint> points, Pen stroke)
        {
            for (var index = 1; index < points.Count; index++)
            {
                var point = points[index];
                if (!point.Break) context.DrawLine(stroke, Project(points[index - 1]), Project(point));
            }
        }
    }
}
