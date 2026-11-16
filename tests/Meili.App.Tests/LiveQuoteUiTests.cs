using System.Windows.Controls;
using Meili.App.Services;
using Meili.App.Views.Pages;
using Meili.Core.Models;
using Meili.Core.Quotes;
namespace Meili.App.Tests;

public sealed class LiveQuoteUiTests
{
    [Fact]public void Native_option_page_binds_live_underlying_without_rewriting_chain_valuation()
    {
        WpfHost.Run(async()=>
        {
            ScreenRenderTests.Apply("zh-CN",true);AppServices.Get<SymbolContext>().Set("AAPL");var page=new OptionsPage();using var host=new OffscreenHost(page,1920,1080);
            var model=(OptionsViewModel)page.DataContext;model.SymbolText="AAPL";
            try
            {
                await model.ActivateAsync();await WpfHost.Settle();var spot=model.Spot;
                AppServices.Get<QuoteHub>().ApplyTicks([new("AAPL",401,DateTimeOffset.UtcNow,MarketState.Regular,Source:"yahoo")]);await WpfHost.Settle();
                Assert.Equal(spot,model.Spot);Assert.Contains(UiAudit.Descendants<TextBlock>(page),t=>t.Text.Contains("401.00")&&t.Text.Contains("推送"));
            }
            finally{model.Deactivate();}
        });
    }
}
