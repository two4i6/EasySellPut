using Avalonia.Controls;
using Avalonia.VisualTree;
using Avalonia.Headless.XUnit;
using Meili.Core.Models;
using Meili.Core.Quotes;
using Meili.Core.Settings;
using Meili.Core.Time;
using Meili.Mac.Platform;
using Meili.Mac.Views.Controls;
using Meili.App.Tests;
namespace Meili.Mac.Tests;
public sealed class QuotePanelTests
{
    [AvaloniaTheory]
    [InlineData("zh-CN",false)] [InlineData("en-US",true)] [InlineData("zh-CN",true)] [InlineData("en-US",false)]
    public async Task Real_panel_renders_all_symbols_changes_intraday_and_keeps_hidden_work_stopped(string language,bool dark)
    {
        MacHost.EnsureComposed();var loc=LocalizationService.Current;loc.Apply(language);var theme=AppServices.Get<MacTheme>();theme.Apply(dark?AppThemeMode.Dark:AppThemeMode.Light);
        var data=new QuotePanelMarketData { Extended = true };var hub=new QuoteHub(data);var context=new SymbolContext();context.Set("AAPL");var store=new SettingsStore(Path.Combine(MacHost.DataDir,"panel"));var watch=new WatchlistStore(store);var model=new QuotePanelViewModel(hub,data,watch,context,loc,store);var opened="";var w=new QuotePanelWindow(model,s=>opened=s,()=>{},()=>{});
        try
        {
            await w.ShowPanelAsync();await Task.Delay(220);MacHost.Pump();Assert.Equal(6,model.Rows.Count);Assert.Contains(w.GetVisualDescendants(), node => node is MarketWatchlist);
            Assert.Contains(model.Rows, row => row.Sparkline.Session == MarketSession.AfterHours && row.HasSparkline);
            Assert.All(model.Rows, row => Assert.True(row.HasExtended));
            Assert.Equal("16:00", model.Selected!.Sparkline.AxisLabels[0]);Assert.Equal(6,hub.SubscribedSymbols.Count);Assert.All(w.GetVisualDescendants().OfType<TextBlock>().Where(t=>t.IsEffectivelyVisible),t=>Assert.True(t.FontSize>=12));
            Assert.NotEmpty(model.Selected.Sparkline.Ema);
            var previousRequests = data.Bars;
            store.Update(value => value.WatchlistSparkline = new SparklineSettings(ShowMa: true, MaPeriod: 4, ShowEma: false));
            MacHost.Pump();
            Assert.Equal(previousRequests, data.Bars);
            Assert.NotEmpty(model.Selected.Sparkline.Ma);
            Assert.Empty(model.Selected.Sparkline.Ema);
            Assert.Contains(w.GetVisualDescendants().OfType<QuoteSparkline>(), chart =>
                chart.IsEffectivelyVisible && chart.Height == 96 && chart.Data.Ma.Count > 0);
            Assert.Contains(w.GetVisualDescendants().OfType<QuoteSparkline>(), chart =>
                chart.IsEffectivelyVisible && chart.Height == 30 && chart.Data.Ma.Count > 0);
            MacHost.Save(w,$"quote-panel-{language}-{dark}");model.Select("NVDA");MacHost.Pump();Assert.Equal("NVDA",model.Selected!.Symbol);Assert.Equal(MarketSession.AfterHours,model.Selected!.Sparkline.Session);
            model.Watchlist.IntradayChoice = model.Watchlist.IntradayChoices.Single(option => option.View == IntradayView.Regular);
            Assert.Equal(MarketSession.Regular,model.Selected!.Sparkline.Session);
            w.HidePanel();Assert.Empty(hub.SubscribedSymbols);var count=data.Bars;await hub.PollAsync();Assert.Equal(count,data.Bars);
            await w.ShowPanelAsync();Assert.Equal(count,data.Bars);w.HidePanel();
        }
        finally{w.Close();loc.Apply("zh-CN");theme.Apply(AppThemeMode.System);}
    }
    [AvaloniaFact] public async Task Chart_work_is_bounded_cancels_on_hide_and_paging_only_subscribes_visible_symbols()
    {
        MacHost.EnsureComposed();var data=new QuotePanelMarketData{Block=true};var hub=new QuoteHub(data);var context=new SymbolContext();context.Set("AAPL");var settings=new SettingsStore(Path.Combine(MacHost.DataDir,"panel-bounds"));var watch=new WatchlistStore(settings);
        using var model=new QuotePanelViewModel(hub,data,watch,context,LocalizationService.Current);
        var loading=model.ActivateAsync();
        model.Watchlist.SetWatchlistViewport(model, 450, model.Rows.Select(row => row.Symbol).ToArray());
        var visibleLoad = model.Watchlist.RefreshAsync();
        await Task.Delay(50);
        MacHost.Pump();
        Assert.InRange(data.MaxFlight, 1, 2);
        model.Deactivate();
        await Task.WhenAll(loading, visibleLoad);
        Assert.Empty(hub.SubscribedSymbols);
        Assert.Equal(0, data.InFlight);
        Assert.False(model.IsBusy);
        data.Block=false;
        await model.ActivateAsync();
        var viewport = model.Rows.Take(3).Select(row => row.Symbol).ToArray();
        model.Watchlist.SetWatchlistViewport(model, 450, viewport);
        await model.RefreshAsync(force: false);
        Assert.All(model.Rows.Where(row => viewport.Contains(row.Symbol)), row => Assert.True(row.HasSparkline));
        Assert.All(model.Rows.Where(row => !viewport.Contains(row.Symbol)), row => Assert.False(row.HasSparkline));
        foreach(var symbol in new[]{"TESTA","TESTB","TESTC"})watch.AddSymbol(watch.Groups[0].Id,symbol,out _);
        model.Watchlist.NextCommand.Execute(null);
        Assert.Equal(2, model.Watchlist.Pages);
        var only = Assert.Single(model.Rows);
        Assert.Equal(new[] { "AAPL", only.Symbol }, hub.SubscribedSymbols.Order().ToArray());
    }
}
