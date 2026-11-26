using Avalonia;
using Avalonia.Controls;
using Avalonia.Data;
using Avalonia.Media;
using Meili.Shared.Services;

namespace Meili.Mac.Views.Controls;

public sealed class QuoteSparkline : Control
{
    public static readonly StyledProperty<IntradaySparkline> DataProperty =
        AvaloniaProperty.Register<QuoteSparkline, IntradaySparkline>(nameof(Data), IntradaySparkline.Empty);
    public static readonly StyledProperty<IBrush> LineBrushProperty =
        AvaloniaProperty.Register<QuoteSparkline, IBrush>(nameof(LineBrush), Brushes.Gray);
    public static readonly StyledProperty<IBrush?> MaBrushProperty =
        AvaloniaProperty.Register<QuoteSparkline, IBrush?>(nameof(MaBrush));
    public static readonly StyledProperty<IBrush?> EmaBrushProperty =
        AvaloniaProperty.Register<QuoteSparkline, IBrush?>(nameof(EmaBrush));
    public static readonly StyledProperty<IBrush?> VwapBrushProperty =
        AvaloniaProperty.Register<QuoteSparkline, IBrush?>(nameof(VwapBrush));

    static QuoteSparkline() => AffectsRender<QuoteSparkline>(DataProperty, LineBrushProperty, MaBrushProperty, EmaBrushProperty, VwapBrushProperty);

    public QuoteSparkline()
    {
        this[!MaBrushProperty] = this.GetResourceObservable("SparklineMaBrush").ToBinding();
        this[!EmaBrushProperty] = this.GetResourceObservable("SparklineEmaBrush").ToBinding();
        this[!VwapBrushProperty] = this.GetResourceObservable("SparklineVwapBrush").ToBinding();
    }

    public IntradaySparkline Data { get => GetValue(DataProperty); set => SetValue(DataProperty, value); }
    public IBrush LineBrush { get => GetValue(LineBrushProperty); set => SetValue(LineBrushProperty, value); }
    public IBrush? MaBrush { get => GetValue(MaBrushProperty); set => SetValue(MaBrushProperty, value); }
    public IBrush? EmaBrush { get => GetValue(EmaBrushProperty); set => SetValue(EmaBrushProperty, value); }
    public IBrush? VwapBrush { get => GetValue(VwapBrushProperty); set => SetValue(VwapBrushProperty, value); }

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        var width = Bounds.Width;
        var height = Bounds.Height;
        if (Data.Points.Count < 2 || width <= 0 || height <= 0) return;

        if (Data.Baseline is { } baseline)
            context.DrawLine(new Pen(LineBrush, .6, new DashStyle([3, 4], 0)), new Point(0, baseline * height), new Point(width, baseline * height));
        if (Data.Ma.Count > 1) DrawSeries(Data.Ma, new Pen(MaBrush ?? Brushes.SteelBlue, 1.2, new DashStyle([3, 2], 0)));
        if (Data.Ema.Count > 1) DrawSeries(Data.Ema, new Pen(EmaBrush ?? Brushes.MediumPurple, 1.2));
        if (Data.Vwap.Count > 1) DrawSeries(Data.Vwap, new Pen(VwapBrush ?? Brushes.DarkOrange, 1.35, new DashStyle([4, 2, 1, 2], 0)));
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
