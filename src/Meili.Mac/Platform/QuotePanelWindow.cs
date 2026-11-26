using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Data;
using Avalonia.Layout;
using Avalonia.Media;
using Meili.Core.Models;
using Meili.Core.Settings;
using Meili.Shared.Services;
using Meili.Shared.ViewModels;
using Meili.Mac.Views.Controls;
namespace Meili.Mac.Platform;

/// <summary>Native, cached market glance surface shared with the Windows tray through QuotePanelViewModel.</summary>
public sealed class QuotePanelWindow : Window
{
    private readonly QuotePanelViewModel _model;private readonly Action<string> _open;
    private readonly LocalizationService _loc;
    private readonly TextBlock _title=new(),_name=new(),_price=new(),_change=new(),_source=new(),_asof=new(),_extended=new(),_date=new(),_status=new(),_empty=new();
    private readonly QuoteSparkline _chart=new(){Height=DesignTokens.QuotePanelHeroSparkHeight,EnableTooltip=true};private readonly TextBlock[] _metrics=[new(),new(),new(),new()];
    private readonly Border _chartSurface = new() { CornerRadius = new(DesignTokens.ControlRadius), Padding = new(DesignTokens.SpaceXS) };
    private readonly AppSelect _sessions = new() { Name = "GlanceSession", MinHeight = 32, FontSize = 12, HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly TextBlock[] _ticks = [new(), new(), new()];
    private readonly UniformGrid _metricGrid = new() { Columns = 2 };
    private readonly Button _refresh,_chartButton;private readonly ToggleButton _pin;
    private readonly DesktopActivity _activity=AppServices.Get<DesktopActivity>();
    private readonly string _activityOwner="quote-panel-window-"+Guid.NewGuid();
    public QuotePanelViewModel Model=>_model;
    public QuotePanelWindow(QuotePanelViewModel model,Action<string> open,Action watchlist,Action quit)
    {
        _model=model;_open=open;_loc=LocalizationService.Current;Width=DesignTokens.MacQuotePanelWidth;Height=DesignTokens.MacQuotePanelHeight;CanResize=false;WindowDecorations=Avalonia.Controls.WindowDecorations.None;ShowInTaskbar=false;Topmost=true;
        this[!BackgroundProperty]=this.GetResourceObservable("ApplicationBackgroundBrush").ToBinding();this[!ForegroundProperty]=this.GetResourceObservable("TextFillColorPrimaryBrush").ToBinding();this[!FontFamilyProperty]=this.GetResourceObservable("AppFont").ToBinding();
        var header=new DockPanel{LastChildFill=true};var tools=new StackPanel{Orientation=Orientation.Horizontal,Spacing=4};DockPanel.SetDock(tools,Dock.Right);header.Children.Add(tools);
        _pin=new ToggleButton{Content=_loc["QP_Pin"],FontSize=12,MinHeight=32,Padding=new Thickness(8,4)};tools.Children.Add(_pin);
        _refresh=IconButton("Refresh","QP_Refresh",async()=>await _model.RefreshAsync());tools.Children.Add(_refresh);tools.Children.Add(IconButton("Close","QP_Close",HidePanel));
        _title.FontSize=18;_title.VerticalAlignment=VerticalAlignment.Center;header.Children.Add(_title);
        header.PointerPressed+=(_,e)=>{if(_pin.IsChecked==true && e.Source==_title && e.GetCurrentPoint(this).Properties.IsLeftButtonPressed)BeginMoveDrag(e);};
        var hero=new StackPanel{Spacing=5,Margin=new Thickness(0,12,0,12)};_name.FontSize=14;_name.TextTrimming=TextTrimming.CharacterEllipsis;hero.Children.Add(_name);
        var prices=new StackPanel{Orientation=Orientation.Horizontal,Spacing=12};_price.FontSize=28;_price.FontWeight=FontWeight.SemiBold;_change.FontSize=16;_change.VerticalAlignment=VerticalAlignment.Center;prices.Children.Add(_price);prices.Children.Add(_change);hero.Children.Add(prices);
        Caption(_source);Caption(_asof);Caption(_extended);Caption(_date);Caption(_empty);_source.TextWrapping=_asof.TextWrapping=_date.TextWrapping=_extended.TextWrapping=TextWrapping.Wrap;hero.Children.Add(_source);hero.Children.Add(_asof);hero.Children.Add(_extended);
        foreach(var key in QuoteGlanceText.SessionKeys) _sessions.Items.Add(new ComboBoxItem { Content = _loc[key] });
        _sessions.SelectedIndex = _model.ChartSessionIndex;
        _sessions.SelectionChanged += (_,_) => _model.SelectChartSession(_sessions.SelectedIndex);
        hero.Children.Add(_sessions);
        _chartSurface.Child=_chart;hero.Children.Add(_chartSurface);var times=new UniformGrid{Columns=3};for(var i=0;i<3;i++){var tick=_ticks[i];tick.HorizontalAlignment=i==0?HorizontalAlignment.Left:i==1?HorizontalAlignment.Center:HorizontalAlignment.Right;Caption(tick);times.Children.Add(tick);}hero.Children.Add(times);hero.Children.Add(_empty);hero.Children.Add(_date);
        var metrics=_metricGrid;metrics.Margin=new Thickness(0,4,0,0);foreach(var t in _metrics){Caption(t);metrics.Children.Add(t);}hero.Children.Add(metrics);
        var list = new MarketWatchlist { DataContext = _model.ConnectWatchlist(AppServices.Get<SettingsStore>()), Owner = _model };
        list.SelectionInvoked += (_, _) => OpenSelected();
        var footer=new DockPanel{LastChildFill=true,Margin=new Thickness(0,10,0,0)};var actions=new StackPanel{Orientation=Orientation.Horizontal,Spacing=5};DockPanel.SetDock(actions,Dock.Right);footer.Children.Add(actions);
        _chartButton=new Button{Content=_loc["QP_Open"],FontSize=13};_chartButton.Click+=(_,_)=>OpenSelected();actions.Children.Add(_chartButton);
        var watch=new Button{FontSize=13};watch[!Button.ContentProperty]=this.GetResourceObservable("QP_Watchlist").ToBinding();watch.Click+=(_,_)=>{HidePanel();watchlist();};actions.Children.Add(watch);
        var more=IconButton("More","QP_More",()=>{});var quitItem=new MenuItem{Header=_loc["Menu_Quit"]};quitItem.Click+=(_,_)=>quit();more.ContextMenu=new ContextMenu{Items={quitItem}};more.Click+=(_,_)=>more.ContextMenu.Open(more);actions.Children.Add(more);
        var content=new Grid{RowDefinitions=new RowDefinitions("Auto,Auto,*,Auto,Auto")};content.Children.Add(header);Grid.SetRow(hero,1);content.Children.Add(hero);Grid.SetRow(list,2);content.Children.Add(list);Grid.SetRow(_status,3);content.Children.Add(_status);Grid.SetRow(footer,4);content.Children.Add(footer);Caption(_status);
        Content=new AppCard{Padding=new Thickness(16),Child=content,CornerRadius=new CornerRadius(16)};
        KeyDown+=(_,e)=>{if(e.Key==Key.Escape){if(_sessions.IsDropDownOpen)_sessions.IsDropDownOpen=false;else HidePanel();e.Handled=true;}};Deactivated+=(_,_)=>{if(_pin.IsChecked!=true && !more.ContextMenu.IsOpen && !_sessions.IsDropDownOpen)HidePanel();};
        Closed+=(_,_)=>{_activity.SetVisible(_activityOwner,false);_model.Changed-=OnChanged;_model.Dispose();};_model.Changed+=OnChanged;UpdateView();
    }
    public async Task ShowPanelAsync(StatusItemAnchor? anchor=null)
    {
        var screen = anchor is { } item
            ? Screens.All.FirstOrDefault(s => s.TryGetPlatformHandle() is { HandleDescriptor: "CGDirectDisplayID" } handle && handle.Handle.ToInt64() == item.DisplayId)
            : null;
        screen ??= Screens.Primary;
        if (screen is not null)
        {
            var scale = screen.Scaling;
            var area = screen.WorkingArea;
            Height = Math.Min(DesignTokens.MacQuotePanelHeight, Math.Max(1, area.Height / scale - 16));
            Position = QuotePanelPlacement.Place(screen.Bounds, area, scale, Width, Height, anchor);
        }
        _activity.SetVisible(_activityOwner,true);Show();Activate();AppMotion.Enter(_title);await _model.ActivateAsync();
    }
    public void HidePanel(){_chart.ClearTooltip();_activity.SetVisible(_activityOwner,false);Hide();_model.Deactivate();}
    private void OpenSelected(){if(_model.Selected is { } row){HidePanel();_open(row.Symbol);}}
    private void OnChanged(object? sender,EventArgs e)=>UpdateView();
    private IBrush Brush(string key)=>Application.Current!.TryGetResource(key,ActualThemeVariant,out var value)&&value is IBrush b?b:Brushes.Gray;
    private void Caption(TextBlock text){text.FontSize=12;text[!TextBlock.ForegroundProperty]=this.GetResourceObservable("TextFillColorSecondaryBrush").ToBinding();}
    private Button IconButton(string kind,string label,Action action){var b=new Button{Width=32,Height=32,MinWidth=32,MinHeight=32,Padding=default,Content=new LucideIcon{Kind=kind,Width=18,Height=18}};b.Classes.Add("Subtle");b[!ToolTip.TipProperty]=this.GetResourceObservable(label).ToBinding();b[!Avalonia.Automation.AutomationProperties.NameProperty]=this.GetResourceObservable(label).ToBinding();b.Click+=(_,_)=>action();return b;}
    private static string Value(double? v)=>v is { } n&&double.IsFinite(n)?NumberDisplay.Price(n):"—";
    private void UpdateView()
    {
        Title=_title.Text=_loc["QP_Title"];_refresh.IsEnabled=!_model.IsBusy;_status.Text=_model.IsBusy?_loc["QP_Refresh"]+"…":_model.Status;
        _pin.Content=_loc["QP_Pin"];_chartButton.Content=_loc["QP_Open"];
        for(var i=0;i<QuoteGlanceText.SessionKeys.Length;i++) ((ComboBoxItem)_sessions.Items[i]!).Content = _loc[QuoteGlanceText.SessionKeys[i]];
        _sessions.SelectedIndex = _model.ChartSessionIndex;
        ToolTip.SetTip(_sessions, _loc["QP_ChartSessionHelp"]);
        Avalonia.Automation.AutomationProperties.SetName(_sessions, _loc["QP_ChartSession"]);
        var selected=_model.Selected;_chartButton.IsEnabled=selected is not null;if(selected is null)return;
        _name.Text=selected.Symbol+" · "+selected.Name;_price.Text=selected.Price;_change.Text=(selected.Display?.Snapshot is { } movementQuote && QuoteMovement.Values(movementQuote).Change is { } movement?NumberDisplay.SignedChange(movement,movementQuote.Price)+"  ":"")+selected.Change;_price.Foreground=_change.Foreground=Brush(selected.BrushKey);
        var q=selected.Quote;var display=selected.Display;
        _source.Text=display is null?_loc["Mb_Unavailable"]:_loc[display.SessionKey]+" · "+display.Snapshot.Currency+" · "+FreshnessText.SourceAndTiming(display.Snapshot,_loc,_model.Now())+(display.Stale(_model.Now(),selected.Failed)?" · "+_loc["Mb_Stale"]:"");
        _asof.Text=FreshnessText.AsOf(display?.Snapshot.AsOf,_loc);
        _extended.Text=q is null||display is null?"":display.Reference(q,_loc);
        _extended.IsVisible=_extended.Text.Length>0;_metricGrid.IsVisible=display?.IsExtended!=true && selected.Graph.Session==Meili.Core.Time.MarketSession.Regular;
        _chartSurface.Background=selected.Graph.Session is Meili.Core.Time.MarketSession.PreMarket or Meili.Core.Time.MarketSession.AfterHours or Meili.Core.Time.MarketSession.Overnight?Brush(selected.Graph.Session==Meili.Core.Time.MarketSession.PreMarket?"PreMarketBackgroundBrush":"AfterHoursBackgroundBrush"):Brushes.Transparent;
        _ticks[0].Text=selected.Graph.StartLabel;_ticks[1].Text=selected.Graph.MiddleLabel;_ticks[2].Text=selected.Graph.EndLabel;
        _chart.Data=selected.Graph;_chart.LineBrush=Brush(selected.GraphBrushKey);_chart.InvalidateVisual();_empty.Text=QuoteGlanceText.EmptyLabel(selected,_loc);_empty.IsVisible=selected.Graph.Points.Count<1;_chart.IsVisible=!_empty.IsVisible;_chartSurface.IsVisible=_chart.IsVisible;
        _date.Text=GraphLabel(selected);_date.IsVisible=selected.Graph.Day is not null;_metrics[0].Text=_loc["QP_OpenPrice"]+"  "+Value(q?.Open);_metrics[1].Text=_loc["QP_High"]+"  "+Value(q?.High);_metrics[2].Text=_loc["QP_Low"]+"  "+Value(q?.Low);_metrics[3].Text=_loc["QP_Volume"]+"  "+NumberDisplay.Compact(q?.Volume);
    }
    private string GraphLabel(PanelQuoteRow row)=>QuoteGlanceText.GraphLabel(row,_loc,_model.Now());
}
