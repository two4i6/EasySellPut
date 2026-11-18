using Meili.Core.Time;
using Meili.Core.Models;
using Meili.App.Views.Controls;
using System.Windows.Input;
using System.Windows.Controls;
using System.Windows;
using System.IO;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Meili.App.Views;
using Meili.Core.Quotes;
using Meili.Core.Settings;
namespace Meili.App.Tests;
public sealed class QuotePanelTests
{
    [Fact] public void Tray_panel_uses_real_native_layout_selection_and_visibility_scoped_subscriptions()
    {
        WpfHost.Run(async()=>
        {
            ScreenRenderTests.Apply("en-US",true);var data=new QuotePanelMarketData();var hub=new QuoteHub(data);var settings=new SettingsStore(Path.Combine(Path.GetTempPath(),"quote-panel-"+Guid.NewGuid()));var watch=new WatchlistStore(settings);var context=new SymbolContext();context.Set("AAPL");
            using var model=new QuotePanelViewModel(hub,data,watch,context,LocalizationService.Current);var panel=new QuotePanelWindow(model,_=>{},()=>{},()=>{});
            try{await panel.ShowPanelAsync();await WpfHost.Settle();Assert.True(panel.IsVisible);Assert.Equal(6,model.Rows.Count);Assert.Equal(6,hub.SubscribedSymbols.Count);
            var workspace=Environment.GetEnvironmentVariable("GITHUB_WORKSPACE");var directory=Environment.GetEnvironmentVariable("MEILI_RENDER_DIR")??(workspace is null?null:Path.Combine(workspace,"build","out","ci"));
            if(directory is not null){await Task.Delay(250);await WpfHost.Settle();Directory.CreateDirectory(directory);var bitmap=new RenderTargetBitmap((int)Math.Ceiling(panel.ActualWidth),(int)Math.Ceiling(panel.ActualHeight),96,96,PixelFormats.Pbgra32);bitmap.Render(panel);var encoder=new PngBitmapEncoder();encoder.Frames.Add(BitmapFrame.Create(bitmap));using var file=File.Create(Path.Combine(directory,"desktop-smoke-quote-panel-windows.png"));encoder.Save(file);}
            model.Select("NVDA");Assert.Equal("NVDA",model.Selected!.Symbol);panel.HidePanel();Assert.Empty(hub.SubscribedSymbols);Assert.False(panel.IsVisible);}
            finally{panel.Close();}
        });
    }
    [Fact] public void Extended_session_uses_new_price_and_matching_axis_in_compact_native_panel()
    {
        WpfHost.Run(async()=>
        {
            var now=Meili.Core.Time.MarketClock.FromEastern(new DateTime(2026,11,16,8,0,0));
            var data=new QuotePanelMarketData{Phase=Meili.Core.Models.MarketState.PreMarket,Clock=now};var hub=new QuoteHub(data);var context=new SymbolContext();context.Set("QQQ");
            var settings=new SettingsStore(Path.Combine(Path.GetTempPath(),"quote-panel-extended-"+Guid.NewGuid()));
            using var model=new QuotePanelViewModel(hub,data,new WatchlistStore(settings),context,LocalizationService.Current){Now=()=>now};var panel=new QuotePanelWindow(model,_=>{},()=>{},()=>{});
            try
            {
                await panel.ShowPanelAsync();await WpfHost.Settle();Assert.Equal(420,panel.Width);
                Assert.True(model.Selected!.Display!.IsExtended);Assert.Equal("-1.00%",model.Selected.Change);Assert.Equal(Meili.Core.Time.MarketSession.PreMarket,model.Selected.Graph.Session);
                Assert.Contains(UiAudit.Descendants<System.Windows.Controls.TextBlock>(panel),t=>t.Text=="04:00");
                Assert.Contains(UiAudit.Descendants<System.Windows.Controls.TextBlock>(panel),t=>t.Text=="09:30");
                panel.HidePanel();Assert.Empty(hub.SubscribedSymbols);
            }
            finally{panel.Close();}
        });
    }
    [Fact] public void Session_selector_keeps_overnight_missing_until_source_data_exists_and_live_postmarket_updates_both_graphs()
    {
        WpfHost.Run(async()=>
        {
            var now=Meili.Core.Time.MarketClock.FromEastern(new DateTime(2026,11,16,18,0,0));
            var data=new QuotePanelMarketData{Phase=Meili.Core.Models.MarketState.AfterHours,Clock=now};var hub=new QuoteHub(data){Now=()=>now};var context=new SymbolContext();context.Set("QQQ");
            using var model=new QuotePanelViewModel(hub,data,new WatchlistStore(new(Path.Combine(Path.GetTempPath(),"session-picker-"+Guid.NewGuid()))),context,LocalizationService.Current){Now=()=>now};var panel=new QuotePanelWindow(model,_=>{},()=>{},()=>{});
            try{await panel.ShowPanelAsync();await WpfHost.Settle();var row=model.Selected!;var count=row.Graph.Points.Count;now=now.AddSeconds(10);hub.ApplyTicks([new("QQQ",row.Quote!.Price*1.02,now,Meili.Core.Models.MarketState.AfterHours,Source:"yahoo")]);await WpfHost.Settle();Assert.True(row.Graph.Points.Count>count);Assert.True(row.ChartObserved);
                var picker=UiAudit.Descendants<Meili.App.Views.Controls.AppSelect>(panel).Single();picker.SelectedIndex=4;await WpfHost.Settle();Assert.Empty(row.Graph.Points);Assert.Equal(Meili.Core.Time.MarketSession.Overnight,row.Graph.Session);Assert.Contains(UiAudit.Descendants<System.Windows.Controls.TextBlock>(panel),t=>t.IsVisible&&t.Text==LocalizationService.Current["QP_NoNightChart"]);picker.SelectedIndex=0;Assert.NotEmpty(row.Graph.Points);panel.HidePanel();Assert.Empty(hub.SubscribedSymbols);}
            finally{panel.Close();}
        });
    }
    [Theory]
    [InlineData("en-US")]
    [InlineData("zh-CN")]
    public void Sparkline_keyboard_tooltip_matches_source_and_closes_on_replacement_and_hide(string language)
    {
        WpfHost.Run(async()=>
        {
            var loc=LocalizationService.Current;var previousLanguage=loc.Language;
            loc.Apply(language);ScreenRenderTests.Apply(language,true);
            var time=MarketClock.FromEastern(new DateTime(2026,11,13,9,30,0));
            var graph=IntradaySparkline.Create(new BarSeries{Symbol="AAPL",Interval=BarInterval.Minute5,Bars=[new(time,100,103,99,102,10),Bar.CloseOnly(time.AddMinutes(5),105,1)]},null,time.AddHours(1));
            var chart=new QuoteSparkline{Width=400,Height=96,EnableTooltip=true,Data=graph};
            var window=new Window{Width=440,Height=240,Content=chart};window.Show();await WpfHost.Settle();
            try
            {
                chart.Focus();
                void Press(Key key)=>chart.RaiseEvent(new KeyEventArgs(Keyboard.PrimaryDevice,PresentationSource.FromVisual(chart),0,key){RoutedEvent=Keyboard.KeyDownEvent});
                var tip=(ToolTip)chart.ToolTip;
                Press(Key.End);await WpfHost.Settle();Assert.True(tip.IsOpen);
                Assert.Equal($"2026-11-13 09:35:00 ET\n{loc["QP_ClosePrice"]}  {NumberDisplay.Price(105)}",((TextBlock)tip.Content).Text);
                Press(Key.Home);await WpfHost.Settle();
                Assert.Equal($"2026-11-13 09:30:00 ET\n{loc["QP_OpenPrice"]}  {NumberDisplay.Price(100)}    {loc["QP_High"]}  {NumberDisplay.Price(103)}\n{loc["QP_Low"]}  {NumberDisplay.Price(99)}    {loc["QP_ClosePrice"]}  {NumberDisplay.Price(102)}",((TextBlock)tip.Content).Text);
                chart.Data=graph with{Source="replacement"};Assert.False(tip.IsOpen);
                Press(Key.Right);Assert.True(tip.IsOpen);window.Hide();await WpfHost.Settle();Assert.False(tip.IsOpen);
            }
            finally{window.Close();loc.Apply(previousLanguage);}
        });
    }
}
