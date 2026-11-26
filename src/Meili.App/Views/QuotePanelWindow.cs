using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using Meili.Shared.Services;
using Meili.Shared.ViewModels;
using Meili.App.Views.Controls;
namespace Meili.App.Views;

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
        _model=model;_open=open;_loc=LocalizationService.Current;Width=540;Height=760;ResizeMode=ResizeMode.NoResize;WindowStyle=WindowStyle.None;ShowInTaskbar=false;Topmost=true;
        SetResourceReference(BackgroundProperty,"ApplicationBackgroundBrush");SetResourceReference(ForegroundProperty,"TextFillColorPrimaryBrush");SetResourceReference(FontFamilyProperty,"AppFont");
        var header=new DockPanel{LastChildFill=true};var tools=new StackPanel{Orientation=Orientation.Horizontal};DockPanel.SetDock(tools,Dock.Right);header.Children.Add(tools);
        _pin=new ToggleButton { Content=_loc["QP_Pin"],MinHeight=32,Padding=new Thickness(8,4,8,4) }.WithFontSize(12);tools.Children.Add(_pin);
        _refresh=IconButton("Refresh","QP_Refresh",async()=>await _model.RefreshAsync());tools.Children.Add(_refresh);tools.Children.Add(IconButton("Close","QP_Close",HidePanel));
        _title.WithFontSize(18);_title.VerticalAlignment=VerticalAlignment.Center;header.Children.Add(_title);
        header.MouseLeftButtonDown+=(_,e)=>{if(_pin.IsChecked==true && e.Source==_title)DragMove();};
        var hero=new StackPanel{Margin=new Thickness(0,12,0,12)};_name.WithFontSize(14);hero.Children.Add(_name);
        var prices=new StackPanel{Orientation=Orientation.Horizontal};_price.WithFontSize(32);_price.FontWeight=FontWeights.SemiBold;_change.Margin=new Thickness(12,0,0,0);_change.WithFontSize(18);_change.VerticalAlignment=VerticalAlignment.Center;prices.Children.Add(_price);prices.Children.Add(_change);hero.Children.Add(prices);
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
        var footer=new DockPanel{LastChildFill=true,Margin=new Thickness(0,10,0,0)};var actions=new StackPanel{Orientation=Orientation.Horizontal};DockPanel.SetDock(actions,Dock.Right);footer.Children.Add(actions);
        _chartButton=new Button { Content=_loc["QP_Open"] }.WithFontSize(13);_chartButton.Click+=(_,_)=>OpenSelected();actions.Children.Add(_chartButton);
        var watch=new Button().WithFontSize(13);watch.SetResourceReference(ContentControl.ContentProperty,"QP_Watchlist");watch.Click+=(_,_)=>{HidePanel();watchlist();};actions.Children.Add(watch);
        var more=IconButton("More","QP_More",()=>{});var quitItem=new MenuItem{Header=_loc["Menu_Quit"]};quitItem.Click+=(_,_)=>quit();more.ContextMenu=new ContextMenu{Items={quitItem}};more.Click+=(_,_)=>more.ContextMenu.IsOpen=true;actions.Children.Add(more);
        var content=RowsGrid();content.Children.Add(header);Grid.SetRow(hero,1);content.Children.Add(hero);Grid.SetRow(_watchlist,2);content.Children.Add(_watchlist);Grid.SetRow(_status,3);content.Children.Add(_status);Grid.SetRow(footer,4);content.Children.Add(footer);Caption(_status);
        foreach(FrameworkElement child in hero.Children)child.Margin=new Thickness(child.Margin.Left,child.Margin.Top,child.Margin.Right,child.Margin.Bottom+5);
        foreach(FrameworkElement child in tools.Children)child.Margin=new Thickness(0,0,4,0);
        foreach(FrameworkElement child in actions.Children)child.Margin=new Thickness(5,0,0,0);
        Content=new AppCard{Padding=new Thickness(16),Content=content};
        KeyDown+=(_,e)=>{if(e.Key==Key.Escape){HidePanel();e.Handled=true;}};Deactivated+=(_,_)=>{if(_pin.IsChecked!=true && !more.ContextMenu.IsOpen)HidePanel();};
        Closed+=(_,_)=>{_activity.SetVisible(_activityOwner,false);_model.Changed-=OnChanged;_model.Dispose();};_model.Changed+=OnChanged;UpdateView();
    }
    private static Grid RowsGrid(){var g=new Grid();foreach(var value in new[]{"Auto","Auto","*","Auto","Auto"})g.RowDefinitions.Add(new RowDefinition{Height=value=="*"?new GridLength(1,GridUnitType.Star):GridLength.Auto});return g;}
    public async Task ShowPanelAsync()
    {
        var area=SystemParameters.WorkArea;Height=Math.Min(760,area.Height-20);Left=area.Right-Width-12;Top=area.Bottom-Height-12;
        _activity.SetVisible(_activityOwner,true);Show();Activate();ComponentMotion.Enter(_title);await _model.ActivateAsync();
    }
    public void HidePanel(){_activity.SetVisible(_activityOwner,false);Hide();_model.Deactivate();}
    private void OpenSelected(){if(_model.Selected is { } row){HidePanel();_open(row.Symbol);}}
    private void OnChanged(object? sender,EventArgs e)=>UpdateView();
    private Brush Brush(string key)=>TryFindResource(key) is Brush b?b:Brushes.Gray;
    private void Caption(TextBlock text){text.WithFontSize(12);text.SetResourceReference(TextBlock.ForegroundProperty,"TextFillColorSecondaryBrush");}
    private Button IconButton(string kind,string label,Action action){var b=new Button{Width=32,Height=32,MinWidth=32,MinHeight=32,Padding=default,Content=new LucideIcon{Kind=kind,Width=18,Height=18}};b.SetResourceReference(StyleProperty,"GhostButton");b.SetResourceReference(ToolTipProperty,label);b.SetResourceReference(System.Windows.Automation.AutomationProperties.NameProperty,label);b.Click+=(_,_)=>action();return b;}
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
        _extended.Visibility = _extended.Text.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
        _chart.Visibility = selected.HasSparkline ? Visibility.Visible : Visibility.Collapsed;
        _empty.Visibility = selected.HasSparkline ? Visibility.Collapsed : Visibility.Visible;
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
