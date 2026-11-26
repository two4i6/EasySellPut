using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Data;
using Avalonia.Layout;
using Avalonia.Media;
using Meili.Shared.Services;
using Meili.Shared.ViewModels;
using Meili.Mac.Views.Controls;
namespace Meili.Mac.Platform;

/// <summary>Native, cached market glance surface shared with the Windows tray through QuotePanelViewModel.</summary>
public sealed class QuotePanelWindow : Window
{
    private readonly QuotePanelViewModel _model;private readonly Action<string> _open;
    private readonly LocalizationService _loc;
    private readonly MarketWatchlist _watchlist;
    private readonly TextBlock[] _axisLabels = [new(), new(), new()];
    private readonly TextBlock _title=new(),_name=new(),_price=new(),_change=new(),_source=new(),_asof=new(),_extended=new(),_date=new(),_status=new(),_empty=new();
    private readonly QuoteSparkline _chart=new(){Height=96};private readonly TextBlock[] _metrics=[new(),new(),new(),new()];
    private readonly Button _refresh,_chartButton;private readonly ToggleButton _pin;
    private readonly DesktopActivity _activity=AppServices.Get<DesktopActivity>();
    private readonly string _activityOwner="quote-panel-window-"+Guid.NewGuid();
    public QuotePanelViewModel Model=>_model;
    public QuotePanelWindow(QuotePanelViewModel model,Action<string> open,Action watchlist,Action quit)
    {
        _model=model;_open=open;_loc=LocalizationService.Current;Width=540;Height=760;CanResize=false;WindowDecorations=Avalonia.Controls.WindowDecorations.None;ShowInTaskbar=false;Topmost=true;
        this[!BackgroundProperty]=this.GetResourceObservable("ApplicationBackgroundBrush").ToBinding();this[!ForegroundProperty]=this.GetResourceObservable("TextFillColorPrimaryBrush").ToBinding();this[!FontFamilyProperty]=this.GetResourceObservable("AppFont").ToBinding();
        var header=new DockPanel{LastChildFill=true};var tools=new StackPanel{Orientation=Orientation.Horizontal,Spacing=4};DockPanel.SetDock(tools,Dock.Right);header.Children.Add(tools);
        _pin=new ToggleButton { Content=_loc["QP_Pin"],MinHeight=32,Padding=new Thickness(8,4) }.WithFontSize(12);tools.Children.Add(_pin);
        _refresh=IconButton("Refresh","QP_Refresh",async()=>await _model.RefreshAsync());tools.Children.Add(_refresh);tools.Children.Add(IconButton("Close","QP_Close",HidePanel));
        _title.WithFontSize(18);_title.VerticalAlignment=VerticalAlignment.Center;header.Children.Add(_title);
        header.PointerPressed+=(_,e)=>{if(_pin.IsChecked==true && e.Source==_title && e.GetCurrentPoint(this).Properties.IsLeftButtonPressed)BeginMoveDrag(e);};
        var hero=new StackPanel{Spacing=5,Margin=new Thickness(0,12,0,12)};_name.WithFontSize(14);hero.Children.Add(_name);
        var prices=new StackPanel{Orientation=Orientation.Horizontal,Spacing=12};_price.WithFontSize(32);_price.FontWeight=FontWeight.SemiBold;_change.WithFontSize(18);_change.VerticalAlignment=VerticalAlignment.Center;prices.Children.Add(_price);prices.Children.Add(_change);hero.Children.Add(prices);
        Caption(_source);Caption(_asof);Caption(_extended);Caption(_date);Caption(_empty);_source.TextWrapping=_asof.TextWrapping=_date.TextWrapping=_extended.TextWrapping=TextWrapping.Wrap;hero.Children.Add(_source);hero.Children.Add(_asof);hero.Children.Add(_extended);hero.Children.Add(_chart);
        var times = new UniformGrid { Columns = 3 };
        for (var index = 0; index < _axisLabels.Length; index++)
        {
            var label = _axisLabels[index];
            label.HorizontalAlignment = index == 0 ? HorizontalAlignment.Left
                : index == 2 ? HorizontalAlignment.Right : HorizontalAlignment.Center;
            Caption(label);
            times.Children.Add(label);
        }
        hero.Children.Add(times);
        hero.Children.Add(_empty);hero.Children.Add(_date);
        var metrics=new UniformGrid{Columns=4,Margin=new Thickness(0,4,0,0)};foreach(var t in _metrics){Caption(t);metrics.Children.Add(t);}hero.Children.Add(metrics);
        _watchlist = new MarketWatchlist { DataContext = _model.Watchlist, Owner = _model };
        _watchlist.SelectionInvoked += (_, _) => OpenSelected();
        var footer=new DockPanel{LastChildFill=true,Margin=new Thickness(0,10,0,0)};var actions=new StackPanel{Orientation=Orientation.Horizontal,Spacing=5};DockPanel.SetDock(actions,Dock.Right);footer.Children.Add(actions);
        _chartButton=new Button { Content=_loc["QP_Open"] }.WithFontSize(13);_chartButton.Click+=(_,_)=>OpenSelected();actions.Children.Add(_chartButton);
        var watch=new Button().WithFontSize(13);watch[!Button.ContentProperty]=this.GetResourceObservable("QP_Watchlist").ToBinding();watch.Click+=(_,_)=>{HidePanel();watchlist();};actions.Children.Add(watch);
        var more=IconButton("More","QP_More",()=>{});var quitItem=new MenuItem{Header=_loc["Menu_Quit"]};quitItem.Click+=(_,_)=>quit();more.ContextMenu=new ContextMenu{Items={quitItem}};more.Click+=(_,_)=>more.ContextMenu.Open(more);actions.Children.Add(more);
        var content=new Grid{RowDefinitions=new RowDefinitions("Auto,Auto,*,Auto,Auto")};content.Children.Add(header);Grid.SetRow(hero,1);content.Children.Add(hero);Grid.SetRow(_watchlist,2);content.Children.Add(_watchlist);Grid.SetRow(_status,3);content.Children.Add(_status);Grid.SetRow(footer,4);content.Children.Add(footer);Caption(_status);
        Content=new AppCard{Padding=new Thickness(16),Child=content,CornerRadius=new CornerRadius(16)};
        KeyDown+=(_,e)=>{if(e.Key==Key.Escape){HidePanel();e.Handled=true;}};Deactivated+=(_,_)=>{if(_pin.IsChecked!=true && !more.ContextMenu.IsOpen)HidePanel();};
        Closed+=(_,_)=>{_activity.SetVisible(_activityOwner,false);_model.Changed-=OnChanged;_model.Dispose();};_model.Changed+=OnChanged;UpdateView();
    }
    public async Task ShowPanelAsync(double? anchorX=null,double? anchorY=null)
    {
        var area=Screens.Primary?.WorkingArea;var scale=Screens.Primary?.Scaling??1;
        if(area is { } a){Height=Math.Min(760,a.Height/scale-20);var x=anchorX is { } ax?(int)(ax*scale-Width*scale):a.Right-(int)(Width*scale)-12;var y=anchorY is { } ay?(int)(ay*scale)+8:a.Y+8;Position=new PixelPoint(Math.Clamp(x,a.X+8,Math.Max(a.X+8,a.Right-(int)(Width*scale)-8)),Math.Clamp(y,a.Y+8,Math.Max(a.Y+8,a.Bottom-(int)(Height*scale)-8)));}
        _activity.SetVisible(_activityOwner,true);Show();Activate();AppMotion.Enter(_title);await _model.ActivateAsync();
    }
    public void HidePanel(){_activity.SetVisible(_activityOwner,false);Hide();_model.Deactivate();}
    private void OpenSelected(){if(_model.Selected is { } row){HidePanel();_open(row.Symbol);}}
    private void OnChanged(object? sender,EventArgs e)=>UpdateView();
    private IBrush Brush(string key)=>this.TryFindResource(key,out var value)&&value is IBrush b?b:Brushes.Gray;
    private void Caption(TextBlock text){text.WithFontSize(12);text[!TextBlock.ForegroundProperty]=this.GetResourceObservable("TextFillColorSecondaryBrush").ToBinding();}
    private Button IconButton(string kind,string label,Action action){var b=new Button{Width=32,Height=32,MinWidth=32,MinHeight=32,Padding=default,Content=new LucideIcon{Kind=kind,Width=18,Height=18}};b.Classes.Add("Subtle");b[!ToolTip.TipProperty]=this.GetResourceObservable(label).ToBinding();b[!Avalonia.Automation.AutomationProperties.NameProperty]=this.GetResourceObservable(label).ToBinding();b.Click+=(_,_)=>action();return b;}
    private void UpdateView()
    {
        Title = _title.Text = _loc["QP_Title"];
        _refresh.IsEnabled = !_model.IsBusy;
        _status.Text = _model.IsBusy ? _loc["QP_Refresh"] + "…" : _model.Status;
        _pin.Content = _loc["QP_Pin"];
        _chartButton.Content = _loc["QP_Open"];
        var selected = _model.Selected;
        _chartButton.IsEnabled = selected is not null;
        if (selected is null) return;

        _name.Text = string.IsNullOrEmpty(selected.Name) ? selected.Symbol : $"{selected.Symbol} · {selected.Name}";
        _price.Text = selected.HeroPrice;
        _change.Text = selected.HeroChange;
        _price.Foreground = _change.Foreground = Brush(selected.HeroBrushKey);
        _source.Text = selected.HeroSource;
        _asof.Text = selected.HeroTimestamp;
        _extended.Text = selected.HeroReference;
        _extended.IsVisible = _extended.Text.Length > 0;
        _chart.IsVisible = selected.HasSparkline;
        _empty.IsVisible = !selected.HasSparkline;
        _chart.Data = selected.Sparkline;
        _chart.LineBrush = Brush(selected.SparklineUp ? "UpBrush" : selected.SparklineDown ? "DownBrush" : "UnknownBrush");
        _empty.Text = _loc["QP_NoChart"];
        _date.Text = selected.HasSparkline ? selected.SparklineTip.Replace('\n', ' ') : "";
        for (var index = 0; index < _axisLabels.Length; index++)
            _axisLabels[index].Text = selected.HasSparkline ? selected.Sparkline.AxisLabels[index] : "";
        _metrics[0].Text = _loc["QP_OpenPrice"] + "  " + selected.Open;
        _metrics[1].Text = _loc["QP_High"] + "  " + selected.High;
        _metrics[2].Text = _loc["QP_Low"] + "  " + selected.Low;
        _metrics[3].Text = _loc["QP_Volume"] + "  " + selected.Volume;
    }
}
