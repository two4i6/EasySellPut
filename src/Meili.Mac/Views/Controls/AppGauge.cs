using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Meili.Shared.Services;
namespace Meili.Mac.Views.Controls;

/// <summary>Theme-bound static 0..100 gauge. Readable text/definitions remain native sibling controls.</summary>
public sealed class AppGauge : Control
{
    public static readonly StyledProperty<double?> ValueProperty=AvaloniaProperty.Register<AppGauge,double?>(nameof(Value));
    public static readonly StyledProperty<IBrush?> LowBrushProperty=AvaloniaProperty.Register<AppGauge,IBrush?>(nameof(LowBrush));
    public static readonly StyledProperty<IBrush?> NormalBrushProperty=AvaloniaProperty.Register<AppGauge,IBrush?>(nameof(NormalBrush));
    public static readonly StyledProperty<IBrush?> HighBrushProperty=AvaloniaProperty.Register<AppGauge,IBrush?>(nameof(HighBrush));
    public static readonly StyledProperty<IBrush?> CriticalBrushProperty=AvaloniaProperty.Register<AppGauge,IBrush?>(nameof(CriticalBrush));
    public static readonly StyledProperty<IBrush?> MarkerBrushProperty=AvaloniaProperty.Register<AppGauge,IBrush?>(nameof(MarkerBrush));
    static AppGauge()=>AffectsRender<AppGauge>(ValueProperty,LowBrushProperty,NormalBrushProperty,HighBrushProperty,CriticalBrushProperty,MarkerBrushProperty);
    public double? Value{get=>GetValue(ValueProperty);set=>SetValue(ValueProperty,value);}
    public IBrush? LowBrush{get=>GetValue(LowBrushProperty);set=>SetValue(LowBrushProperty,value);}
    public IBrush? NormalBrush{get=>GetValue(NormalBrushProperty);set=>SetValue(NormalBrushProperty,value);}
    public IBrush? HighBrush{get=>GetValue(HighBrushProperty);set=>SetValue(HighBrushProperty,value);}
    public IBrush? CriticalBrush{get=>GetValue(CriticalBrushProperty);set=>SetValue(CriticalBrushProperty,value);}
    public IBrush? MarkerBrush{get=>GetValue(MarkerBrushProperty);set=>SetValue(MarkerBrushProperty,value);}
    public override void Render(DrawingContext context)
    {
        base.Render(context);var plan=GaugePlan.Create(Bounds.Width,Bounds.Height,Value);IBrush?[] brushes=[LowBrush,NormalBrush,HighBrush,CriticalBrush];
        for(var i=0;i<plan.Bands.Count;i++)
        {
            var points=plan.Bands[i];var geometry=new StreamGeometry();using(var path=geometry.Open()){path.BeginFigure(new(points[0].X,points[0].Y),false);foreach(var p in points.Skip(1))path.LineTo(new(p.X,p.Y));path.EndFigure(false);}
            context.DrawGeometry(null,new Pen(brushes[i],DesignTokens.GaugeStroke),geometry);
        }
        if(plan.Marker is { } marker)context.DrawEllipse(MarkerBrush,null,new Point(marker.X,marker.Y),DesignTokens.GaugeMarker,DesignTokens.GaugeMarker);
    }
}
