using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Meili.Shared.Services;
namespace Meili.Mac.Views.Controls;
public sealed class QuoteSparkline : Control
{
    public IntradaySparkline Data{get;set;}=IntradaySparkline.Empty;
    public IBrush LineBrush{get;set;}=Brushes.Gray;
    public override void Render(DrawingContext context)
    {
        base.Render(context);var w=Bounds.Width;var h=Bounds.Height;if(Data.Points.Count<1||w<=0||h<=0)return;
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
        var last=Data.Points[^1];context.DrawEllipse(LineBrush,null,new Point(last.X*w,last.Y*h),2,2);
    }
}
