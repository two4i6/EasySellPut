using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Markup.Xaml.MarkupExtensions;
namespace Meili.Mac.Views.Controls;

/// <summary>Reusable live-content split: no overlay, no WebView reparenting on resize, no layout animation.</summary>
public sealed class ArticleSplitView : Grid
{
    private readonly GridSplitter _divider=new();
    private readonly Border _article=new();
    private readonly Control _main;
    private bool _open,_vertical;
    public bool IsOpen=>_open;
    public bool IsVertical=>_vertical;
    public ArticleSplitView(Control main)
    {
        _main=main;Children.Add(main);Children.Add(_divider);Children.Add(_article);
        _article.Bind(Border.BackgroundProperty,new DynamicResourceExtension("ApplicationBackgroundBrush"));
        _divider.Bind(GridSplitter.BackgroundProperty,new DynamicResourceExtension("ControlStrokeColorDefaultBrush"));
        _divider.HorizontalAlignment=HorizontalAlignment.Stretch;_divider.VerticalAlignment=VerticalAlignment.Stretch;
        SizeChanged+=(_,_)=>{if(_open)LayoutSplit();};
        SetOpen(false);
    }
    public void Open(Control article){_article.Child=article;SetOpen(true);}
    public void Close(){_article.Child=null;SetOpen(false);}
    private void SetOpen(bool open)
    {
        _open=open;_divider.IsVisible=_article.IsVisible=open;
        LayoutSplit(true);
    }
    private void LayoutSplit(bool force=false)
    {
        var vertical=Bounds.Width>0&&Bounds.Width<1100;
        if(!force&&vertical==_vertical)return;
        _vertical=vertical;
        // Keep definition objects stable: native content must never detach on resize.
        if(ColumnDefinitions.Count==0)for(var i=0;i<3;i++)ColumnDefinitions.Add(new ColumnDefinition());
        if(RowDefinitions.Count==0)for(var i=0;i<3;i++)RowDefinitions.Add(new RowDefinition());
        for(var i=0;i<3;i++)
        {
            ColumnDefinitions[i].Width=i==0?new GridLength(1,GridUnitType.Star):new GridLength(0);ColumnDefinitions[i].MinWidth=0;
            RowDefinitions[i].Height=i==0?new GridLength(1,GridUnitType.Star):new GridLength(0);RowDefinitions[i].MinHeight=0;
        }
        SetColumn(_main,0);SetRow(_main,0);SetColumn(_divider,vertical?0:1);SetRow(_divider,vertical?1:0);SetColumn(_article,vertical?0:2);SetRow(_article,vertical?2:0);
        if(!_open)return;
        if(vertical)
        {
            RowDefinitions[0].Height=new GridLength(5,GridUnitType.Star);RowDefinitions[0].MinHeight=220;
            RowDefinitions[1].Height=new GridLength(6);
            RowDefinitions[2].Height=new GridLength(4,GridUnitType.Star);RowDefinitions[2].MinHeight=180;
            _divider.ResizeDirection=GridResizeDirection.Rows;
        }
        else
        {
            ColumnDefinitions[0].Width=new GridLength(5,GridUnitType.Star);ColumnDefinitions[0].MinWidth=500;
            ColumnDefinitions[1].Width=new GridLength(6);
            ColumnDefinitions[2].Width=new GridLength(4,GridUnitType.Star);ColumnDefinitions[2].MinWidth=340;
            _divider.ResizeDirection=GridResizeDirection.Columns;
        }
    }
}
