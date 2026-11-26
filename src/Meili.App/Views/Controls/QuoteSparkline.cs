using System.Windows.Input;
using System.Windows.Controls.Primitives;
using System.Windows.Controls;
using System.Windows;
using System.Windows.Media;
using Meili.Shared.Services;

namespace Meili.App.Views.Controls;

public sealed class QuoteSparkline : FrameworkElement
{
    public static readonly DependencyProperty DataProperty =
        DependencyProperty.Register(nameof(Data), typeof(IntradaySparkline), typeof(QuoteSparkline),
            new FrameworkPropertyMetadata(IntradaySparkline.Empty, FrameworkPropertyMetadataOptions.AffectsRender, (target, _) => ((QuoteSparkline)target).ClearTooltip()));
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

    private SparkPoint? _selected;
    private readonly TextBlock _tipText=new(){MaxWidth=300,TextWrapping=TextWrapping.Wrap};
    private readonly ToolTip _tip=new(){Placement=PlacementMode.MousePoint,MaxWidth=300};
    public IntradaySparkline Data { get => (IntradaySparkline)GetValue(DataProperty); set => SetValue(DataProperty, value); }
    public Brush LineBrush { get => (Brush)GetValue(LineBrushProperty); set => SetValue(LineBrushProperty, value); }
    public Brush? MaBrush { get => (Brush?)GetValue(MaBrushProperty); set => SetValue(MaBrushProperty, value); }
    public Brush? EmaBrush { get => (Brush?)GetValue(EmaBrushProperty); set => SetValue(EmaBrushProperty, value); }
    public Brush? VwapBrush { get => (Brush?)GetValue(VwapBrushProperty); set => SetValue(VwapBrushProperty, value); }

    public bool EnableTooltip { get=>Focusable; set=>Focusable=value; }
    public QuoteSparkline()
    {
        SetResourceReference(MaBrushProperty, "SparklineMaBrush");
        SetResourceReference(EmaBrushProperty, "SparklineEmaBrush");
        SetResourceReference(VwapBrushProperty, "SparklineVwapBrush");
        _tipText.SetResourceReference(TextBlock.FontSizeProperty,"CaptionFontSize");
        SetResourceReference(System.Windows.Automation.AutomationProperties.NameProperty,"QP_Intraday");
        _tip.PlacementTarget=this;_tip.Content=_tipText;ToolTip=_tip;ToolTipService.SetIsEnabled(this,false);
        _tipText.SetResourceReference(TextBlock.FontFamilyProperty,"AppFont");
        _tipText.SetResourceReference(TextBlock.ForegroundProperty,"TextFillColorPrimaryBrush");
        MouseMove+=(_,e)=>{if(EnableTooltip){_tip.Placement=PlacementMode.MousePoint;Show(Data.HitTest(e.GetPosition(this).X/ActualWidth));}};
        MouseDown+=(_,e)=>{if(EnableTooltip){Focus();Show(Data.HitTest(e.GetPosition(this).X/ActualWidth));}};
        TouchDown+=(_,e)=>{if(EnableTooltip){Focus();Show(Data.HitTest(e.GetTouchPoint(this).Position.X/ActualWidth));e.Handled=true;}};
        TouchMove+=(_,e)=>{if(EnableTooltip){Show(Data.HitTest(e.GetTouchPoint(this).Position.X/ActualWidth));e.Handled=true;}};
        TouchUp+=(_,e)=>{ClearTooltip();if(EnableTooltip)e.Handled=true;};
        MouseLeave+=(_,_)=>ClearTooltip();LostKeyboardFocus+=(_,_)=>ClearTooltip();
        Unloaded+=(_,_)=>ClearTooltip();IsVisibleChanged+=(_,_)=>{if(!IsVisible)ClearTooltip();};
        KeyDown+=(_,e)=>
        {
            if(!EnableTooltip)return;
            if(e.Key==Key.Escape){ClearTooltip();return;}
            if(e.Key is not (Key.Left or Key.Right or Key.Home or Key.End))return;
            var points=Data.Points.Where(p=>p.Bar is not null).ToArray();if(points.Length==0)return;
            var index=Array.IndexOf(points,_selected);
            index=e.Key switch{Key.Home=>0,Key.End=>points.Length-1,Key.Left=>Math.Max(0,index-1),_=>Math.Min(points.Length-1,index+1)};
            _tip.Placement=PlacementMode.Bottom;Show(points[index]);e.Handled=true;
        };
    }
    private void Show(SparkPoint? point)
    {
        if(point is null){ClearTooltip();return;}
        _selected=point;_tipText.Text=IntradaySparkline.Tooltip(point,LocalizationService.Current);
        _tip.IsOpen=true;InvalidateVisual();
    }
    public void ClearTooltip()
    {
        _selected=null;_tip.IsOpen=false;_tip.Placement=PlacementMode.MousePoint;InvalidateVisual();
    }
    protected override void OnRender(DrawingContext context)
    {
        base.OnRender(context);context.DrawRectangle(Brushes.Transparent,null,new Rect(RenderSize));var w=ActualWidth;var h=ActualHeight;if(Data.Points.Count<1||w<=0||h<=0)return;
        if(Data.Baseline is { } b)context.DrawLine(new Pen(LineBrush,.6){DashStyle=DashStyles.Dash},new Point(0,b*h),new Point(w,b*h));
        // Solid strokes are observed segments. Dotted guides only link the endpoints of
        // missing intervals in a received-only window; they are not market observations.
        DrawOverlay(Data.Ma, new Pen(MaBrush ?? Brushes.SteelBlue, 1.2) { DashStyle = DashStyles.Dash });
        DrawOverlay(Data.Ema, new Pen(EmaBrush ?? Brushes.MediumPurple, 1.2));
        DrawOverlay(Data.Vwap, new Pen(VwapBrush ?? Brushes.DarkOrange, 1.35) { DashStyle = DashStyles.DashDot });
        void DrawOverlay(IReadOnlyList<SparkPoint> points, Pen pen)
        {
            for (var i = 1; i < points.Count; i++)
                if (!points[i].Break) context.DrawLine(pen, new Point(points[i-1].X*w,points[i-1].Y*h),new Point(points[i].X*w,points[i].Y*h));
        }
        SparkPoint? previous=null;
        for(var i=0;i<Data.Points.Count;i++)
        {
            var p=Data.Points[i];
            if(previous is { } old)
            {
                if(!p.Break)context.DrawLine(new Pen(LineBrush,1.7),new Point(old.X*w,old.Y*h),new Point(p.X*w,p.Y*h));
                else if(p.GapGuide)context.DrawLine(new Pen(LineBrush,.8){DashStyle=new DashStyle(new double[]{2,5},0)},new Point(old.X*w,old.Y*h),new Point(p.X*w,p.Y*h));
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
