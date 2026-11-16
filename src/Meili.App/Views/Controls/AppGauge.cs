using System.Windows;
using System.Windows.Media;
using Meili.Shared.Services;
namespace Meili.App.Views.Controls;

public sealed class AppGauge : FrameworkElement
{
    private static DependencyProperty BrushProperty(string name)=>DependencyProperty.Register(name,typeof(Brush),typeof(AppGauge),new FrameworkPropertyMetadata(null,FrameworkPropertyMetadataOptions.AffectsRender));
    public static readonly DependencyProperty ValueProperty=DependencyProperty.Register(nameof(Value),typeof(double?),typeof(AppGauge),new FrameworkPropertyMetadata(null,FrameworkPropertyMetadataOptions.AffectsRender));
    public static readonly DependencyProperty LowBrushProperty=BrushProperty(nameof(LowBrush));
    public static readonly DependencyProperty NormalBrushProperty=BrushProperty(nameof(NormalBrush));
    public static readonly DependencyProperty HighBrushProperty=BrushProperty(nameof(HighBrush));
    public static readonly DependencyProperty CriticalBrushProperty=BrushProperty(nameof(CriticalBrush));
    public static readonly DependencyProperty MarkerBrushProperty=BrushProperty(nameof(MarkerBrush));
    public double? Value{get=>(double?)GetValue(ValueProperty);set=>SetValue(ValueProperty,value);}
    public Brush? LowBrush{get=>(Brush?)GetValue(LowBrushProperty);set=>SetValue(LowBrushProperty,value);}
    public Brush? NormalBrush{get=>(Brush?)GetValue(NormalBrushProperty);set=>SetValue(NormalBrushProperty,value);}
    public Brush? HighBrush{get=>(Brush?)GetValue(HighBrushProperty);set=>SetValue(HighBrushProperty,value);}
    public Brush? CriticalBrush{get=>(Brush?)GetValue(CriticalBrushProperty);set=>SetValue(CriticalBrushProperty,value);}
    public Brush? MarkerBrush{get=>(Brush?)GetValue(MarkerBrushProperty);set=>SetValue(MarkerBrushProperty,value);}
    protected override void OnRender(DrawingContext context)
    {
        base.OnRender(context);var plan=GaugePlan.Create(ActualWidth,ActualHeight,Value);Brush?[] brushes=[LowBrush,NormalBrush,HighBrush,CriticalBrush];
        for(var i=0;i<plan.Bands.Count;i++)
        {
            var points=plan.Bands[i];var geometry=new StreamGeometry();using(var path=geometry.Open()){path.BeginFigure(new(points[0].X,points[0].Y),false,false);path.PolyLineTo(points.Skip(1).Select(p=>new Point(p.X,p.Y)).ToArray(),true,false);}
            context.DrawGeometry(null,new Pen(brushes[i],DesignTokens.GaugeStroke),geometry);
        }
        if(plan.Marker is { } marker)context.DrawEllipse(MarkerBrush,null,new Point(marker.X,marker.Y),DesignTokens.GaugeMarker,DesignTokens.GaugeMarker);
    }
}
