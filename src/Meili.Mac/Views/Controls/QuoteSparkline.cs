using Avalonia.Controls.Primitives;
using Avalonia.Data;
using Avalonia.Input;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Meili.Shared.Services;
namespace Meili.Mac.Views.Controls;
public sealed class QuoteSparkline : Control
{
    private IntradaySparkline _data=IntradaySparkline.Empty;
    private SparkPoint? _selected;
    private readonly TextBlock _tip=new(){MaxWidth=300,FontSize=DesignTokens.CaptionFontSize,TextWrapping=TextWrapping.Wrap};
    public IntradaySparkline Data
    {
        get=>_data;
        set{if(ReferenceEquals(value,_data))return;ClearTooltip();_data=value;InvalidateVisual();}
    }
    public bool EnableTooltip { get=>Focusable; set=>Focusable=value; }
    public QuoteSparkline()
    {
        this[!Avalonia.Automation.AutomationProperties.NameProperty]=this.GetResourceObservable("QP_Intraday").ToBinding();
        _tip[!TextBlock.FontFamilyProperty]=this.GetResourceObservable("AppFont").ToBinding();
        _tip[!TextBlock.ForegroundProperty]=this.GetResourceObservable("TextFillColorPrimaryBrush").ToBinding();
        ToolTip.SetServiceEnabled(this,false);
        ToolTip.SetPlacement(this,PlacementMode.Pointer);
        PointerMoved+=(_,e)=>{if(EnableTooltip){ToolTip.SetPlacement(this,PlacementMode.Pointer);Show(Data.HitTest(e.GetPosition(this).X/Bounds.Width));}};
        PointerPressed+=(_,e)=>{if(EnableTooltip){Focus();Show(Data.HitTest(e.GetPosition(this).X/Bounds.Width));}};
        PointerReleased+=(_,e)=>{if(e.Pointer.Type==PointerType.Touch)ClearTooltip();};
        PointerExited+=(_,_)=>ClearTooltip();
        LostFocus+=(_,_)=>ClearTooltip();
        DetachedFromVisualTree+=(_,_)=>ClearTooltip();
        KeyDown+=(_,e)=>
        {
            if(!EnableTooltip)return;
            if(e.Key==Key.Escape){ClearTooltip();return;}
            if(e.Key is not (Key.Left or Key.Right or Key.Home or Key.End))return;
            var points=Data.Points.Where(p=>p.Bar is not null).ToArray();if(points.Length==0)return;
            var index=Array.IndexOf(points,_selected);
            index=e.Key switch{Key.Home=>0,Key.End=>points.Length-1,Key.Left=>Math.Max(0,index-1),_=>Math.Min(points.Length-1,index+1)};
            ToolTip.SetPlacement(this,PlacementMode.Bottom);Show(points[index]);e.Handled=true;
        };
    }
    private void Show(SparkPoint? point)
    {
        if(point is null){ClearTooltip();return;}
        _selected=point;_tip.Text=IntradaySparkline.Tooltip(point,LocalizationService.Current);
        ToolTip.SetTip(this,_tip);ToolTip.SetIsOpen(this,true);InvalidateVisual();
    }
    public void ClearTooltip()
    {
        _selected=null;ToolTip.SetIsOpen(this,false);ToolTip.SetTip(this,null);
        ToolTip.SetPlacement(this,PlacementMode.Pointer);InvalidateVisual();
    }
    public IBrush LineBrush{get;set;}=Brushes.Gray;
    public override void Render(DrawingContext context)
    {
        base.Render(context);context.DrawRectangle(Brushes.Transparent,null,new Rect(Bounds.Size));var w=Bounds.Width;var h=Bounds.Height;if(Data.Points.Count<1||w<=0||h<=0)return;
        if(Data.Baseline is { } b)context.DrawLine(new Pen(LineBrush,.6,new DashStyle([3,4],0)),new Point(0,b*h),new Point(w,b*h));
        // Solid strokes are observed segments. Dotted guides only link the endpoints of
        // missing intervals in a received-only window; they are not market observations.
        SparkPoint? previous=null;
        for(var i=0;i<Data.Points.Count;i++)
        {
            var p=Data.Points[i];
            if(previous is { } old)
            {
                if(!p.Break)context.DrawLine(new Pen(LineBrush,1.7),new Point(old.X*w,old.Y*h),new Point(p.X*w,p.Y*h));
                else if(p.GapGuide)context.DrawLine(new Pen(LineBrush,.8,new DashStyle([2,5],0)),new Point(old.X*w,old.Y*h),new Point(p.X*w,p.Y*h));
            }
            if(p.Break || i+1<Data.Points.Count && Data.Points[i+1].Break)
                context.DrawEllipse(LineBrush,null,new Point(p.X*w,p.Y*h),1.7,1.7);
            previous=p;
        }
        if(_selected is { } selected)
        {
            context.DrawLine(new Pen(LineBrush,.6),new Point(selected.X*w,0),new Point(selected.X*w,h));
            context.DrawEllipse(LineBrush,null,new Point(selected.X*w,selected.Y*h),3,3);
        }
        var last=Data.Points[^1];context.DrawEllipse(LineBrush,null,new Point(last.X*w,last.Y*h),2,2);
    }
}
