using Avalonia.Controls;
using Avalonia.VisualTree;
using Avalonia.Headless.XUnit;
using Meili.Core.Models;
using Meili.Core.Quotes;
using Meili.Core.Settings;
using Meili.Core.Time;
using Meili.Mac.Platform;
using Meili.App.Tests;
namespace Meili.Mac.Tests;
public sealed class QuotePanelTests
{
    [AvaloniaTheory]
    [InlineData("zh-CN",false)] [InlineData("en-US",true)] [InlineData("zh-CN",true)] [InlineData("en-US",false)]
    public async Task Real_panel_renders_all_symbols_changes_intraday_and_keeps_hidden_work_stopped(string language,bool dark)
    {
        MacHost.EnsureComposed();var loc=LocalizationService.Current;loc.Apply(language);var theme=AppServices.Get<MacTheme>();theme.Apply(dark?AppThemeMode.Dark:AppThemeMode.Light);
        var data=new QuotePanelMarketData();var hub=new QuoteHub(data);var context=new SymbolContext();context.Set("AAPL");var store=new SettingsStore(Path.Combine(MacHost.DataDir,"panel"));var watch=new WatchlistStore(store);var model=new QuotePanelViewModel(hub,data,watch,context,loc);var opened="";var w=new QuotePanelWindow(model,s=>opened=s,()=>{},()=>{});
        try
        {
            await w.ShowPanelAsync();await Task.Delay(220);MacHost.Pump();Assert.Equal(6,model.Rows.Count);Assert.All(model.Rows,r=>Assert.True(r.Graph.Points.Count>10));Assert.Equal(6,hub.SubscribedSymbols.Count);Assert.All(w.GetVisualDescendants().OfType<TextBlock>().Where(t=>t.IsEffectivelyVisible),t=>Assert.True(t.FontSize>=12));
            MacHost.Save(w,$"quote-panel-{language}-{dark}");model.Select("NVDA");MacHost.Pump();Assert.Equal("NVDA",model.Selected!.Symbol);Assert.NotEqual(model.Rows[0].Graph.Points[10].Y,model.Rows[^1].Graph.Points[10].Y);
            w.HidePanel();Assert.Empty(hub.SubscribedSymbols);var count=data.Bars;await hub.PollAsync();Assert.Equal(count,data.Bars);
            await w.ShowPanelAsync();Assert.Equal(count,data.Bars);w.HidePanel();
        }
        finally{w.Close();loc.Apply("zh-CN");theme.Apply(AppThemeMode.System);}
    }
    [AvaloniaFact] public async Task Chart_work_is_bounded_cancels_on_hide_and_paging_only_subscribes_visible_symbols()
    {
        MacHost.EnsureComposed();var data=new QuotePanelMarketData{Block=true};var hub=new QuoteHub(data);var context=new SymbolContext();context.Set("AAPL");var settings=new SettingsStore(Path.Combine(MacHost.DataDir,"panel-bounds"));var watch=new WatchlistStore(settings);
        using var model=new QuotePanelViewModel(hub,data,watch,context,LocalizationService.Current);
        var loading=model.ActivateAsync();await Task.Delay(50);MacHost.Pump();Assert.InRange(data.MaxFlight,1,2);model.Deactivate();await loading;Assert.Empty(hub.SubscribedSymbols);Assert.Equal(0,data.InFlight);Assert.False(model.IsBusy);
        data.Block=false;await model.ActivateAsync();Assert.All(model.Rows,r=>Assert.NotEmpty(r.Graph.Points));
        foreach(var symbol in new[]{"TESTA","TESTB","TESTC"})watch.AddSymbol(watch.Groups[0].Id,symbol,out _);
        await model.MoveAsync(1);Assert.Equal(2,model.Pages);Assert.Single(model.Rows);Assert.Single(hub.SubscribedSymbols);
    }
    [AvaloniaTheory]
    [InlineData(true,"zh-CN",false)] [InlineData(false,"en-US",true)]
    public async Task Compact_extended_panel_uses_matching_session_prices_axes_and_dates(bool pre,string language,bool dark)
    {
        MacHost.EnsureComposed();var loc=LocalizationService.Current;loc.Apply(language);var theme=AppServices.Get<MacTheme>();theme.Apply(dark?AppThemeMode.Dark:AppThemeMode.Light);
        var now=MarketClock.FromEastern(new DateTime(2026,11,16,pre?8:18,0,0));
        var data=new QuotePanelMarketData{Phase=pre?MarketState.PreMarket:MarketState.AfterHours,Clock=now};var hub=new QuoteHub(data);var context=new SymbolContext();context.Set("QQQ");
        var store=new SettingsStore(Path.Combine(MacHost.DataDir,"panel-extended-"+pre));
        using var model=new QuotePanelViewModel(hub,data,new WatchlistStore(store),context,loc){Now=()=>now};
        var window=new QuotePanelWindow(model,_=>{},()=>{},()=>{});
        try
        {
            await window.ShowPanelAsync();MacHost.Pump();Assert.Equal(360,window.Width);Assert.InRange(window.Height,400,640);
            Assert.All(model.Rows,row=>{Assert.True(row.Display!.IsExtended);Assert.Equal(pre?MarketSession.PreMarket:MarketSession.AfterHours,row.Graph.Session);Assert.Equal(new DateOnly(2026,11,16),row.Graph.Day);Assert.NotEmpty(row.Graph.Points);Assert.Equal(pre?"-1.00%":"+1.00%",row.Change);});
            Assert.Contains(window.GetVisualDescendants().OfType<TextBlock>(),t=>t.Text==(pre?"04:00":"16:00"));
            Assert.Contains(window.GetVisualDescendants().OfType<TextBlock>(),t=>t.Text==(pre?"09:30":"20:00"));
            var heroPrice=window.GetVisualDescendants().OfType<TextBlock>().Single(t=>t.FontSize==28&&t.Text==model.Selected!.Price);
            Assert.Equal(((Avalonia.Media.ISolidColorBrush)Ui.Platform.Resource(model.Selected!.BrushKey)!).Color,((Avalonia.Media.ISolidColorBrush)heroPrice.Foreground!).Color);
            MacHost.Save(window,$"quote-panel-extended-{pre}-{language}-{dark}");
            // Same real controls in a Full HD app-owned test scene for honest size comparison, not an OS screenshot.
            var pin=window.GetVisualDescendants().OfType<Avalonia.Controls.Primitives.ToggleButton>().Single();pin.IsChecked=true;
            var desktop=new MainWindow{Width=1920,Height=1080};desktop.Show();desktop.Navigate(AppPage.Dashboard);pin.IsChecked=false;
            var body=(Control)window.Content!;window.Content=null;
            try
            {
                body.Width=window.Width;body.Height=window.Height;body.HorizontalAlignment=Avalonia.Layout.HorizontalAlignment.Right;body.VerticalAlignment=Avalonia.Layout.VerticalAlignment.Top;body.Margin=new Avalonia.Thickness(0,24,24,0);
                var root=((DockPanel)desktop.Content!).Children.OfType<Grid>().Single();root.Children.Add(body);Grid.SetRowSpan(body,100);Grid.SetColumnSpan(body,100);MacHost.Pump();MacHost.Save(desktop,$"quote-panel-scene-1080p-{pre}-{language}-{dark}");root.Children.Remove(body);
            }
            finally{window.Content=body;desktop.Close();}
            window.HidePanel();Assert.Empty(hub.SubscribedSymbols);
        }
        finally{window.Close();loc.Apply("zh-CN");theme.Apply(AppThemeMode.System);}
    }

    [AvaloniaFact] public async Task New_extended_quote_does_not_reuse_an_older_regular_chart_when_extended_bars_are_missing()
    {
        MacHost.EnsureComposed();var now=MarketClock.FromEastern(new DateTime(2026,11,16,8,0,0));
        var data=new QuotePanelMarketData{Phase=MarketState.PreMarket,Clock=now,RegularBarsOnly=true};var hub=new QuoteHub(data);var context=new SymbolContext();context.Set("AAPL");
        using var model=new QuotePanelViewModel(hub,data,new WatchlistStore(new(Path.Combine(MacHost.DataDir,"panel-no-extended"))),context,LocalizationService.Current){Now=()=>now};
        await model.ActivateAsync();Assert.True(model.Selected!.Display!.IsExtended);Assert.Empty(model.Selected.Graph.Points);Assert.Equal(MarketSession.PreMarket,model.Selected.Graph.Session);model.Deactivate();
    }
}
