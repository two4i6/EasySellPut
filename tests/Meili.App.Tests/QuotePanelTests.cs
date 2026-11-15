using System.IO;
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
            ScreenRenderTests.Apply("en-US",true);var data=new FakeMarketDataService();var hub=new QuoteHub(data);var settings=new SettingsStore(Path.Combine(Path.GetTempPath(),"quote-panel-"+Guid.NewGuid()));var watch=new WatchlistStore(settings);var context=new SymbolContext();context.Set("AAPL");
            using var model=new QuotePanelViewModel(hub,data,watch,context,LocalizationService.Current);var panel=new QuotePanelWindow(model,_=>{},()=>{},()=>{});
            try{await panel.ShowPanelAsync();await WpfHost.Settle();Assert.True(panel.IsVisible);Assert.Equal(6,model.Rows.Count);Assert.Equal(6,hub.SubscribedSymbols.Count);model.Select("NVDA");Assert.Equal("NVDA",model.Selected!.Symbol);panel.HidePanel();Assert.Empty(hub.SubscribedSymbols);Assert.False(panel.IsVisible);}
            finally{panel.Close();}
        });
    }
}
