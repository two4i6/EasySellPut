using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.VisualTree;
using Meili.Core.Models;
using Meili.Core.Quotes;
using Meili.Core.Settings;
using Meili.Mac.Platform;
using Meili.Mac.Views;
namespace Meili.Mac.Tests;

public sealed class LiveQuoteUiTests
{
    [AvaloniaTheory][InlineData("zh-CN",true)][InlineData("en-US",false)]
    public async Task Actual_shared_quote_broadcast_changes_visible_cards_to_push_and_chart_follows_same_hub(string language,bool dark)
    {
        MacHost.EnsureComposed();var loc=LocalizationService.Current;var original=loc.Language;loc.Apply(language);var theme=AppServices.Get<MacTheme>();theme.Apply(dark?AppThemeMode.Dark:AppThemeMode.Light);
        var page=new DashboardPage();var model=(DashboardViewModel)page.DataContext!;var window=new Window{Content=page,Width=1920,Height=1080};
        var hub=AppServices.Get<QuoteHub>();
        try
        {
            window.Show();await model.ActivateAsync();MacHost.Pump();
            hub.ApplyTicks(model.Quotes.Select((q,i)=>new QuoteTick(q.Symbol,150+i,DateTimeOffset.UtcNow,MarketState.Regular,1,0.5,10000,Source:"yahoo")).ToArray());MacHost.Pump();
            Assert.All(model.Quotes,q=>Assert.Contains(loc["Quote_Push"],q.SourceText));
            Assert.All(model.Quotes,q=>Assert.Contains(loc["Quote_StreamCoverage"],q.TimingTip));
            MacHost.Save(window,$"yahoo-push-dashboard-1080p-{language}-{dark}");
            var chart=AppServices.Get<ChartsViewModel>();await chart.OpenSymbolAsync("AAPL");await chart.ActivateAsync();
            try
            {
                hub.ApplyTicks([new("AAPL",155,DateTimeOffset.UtcNow.AddMilliseconds(1),MarketState.Regular,Source:"yahoo")]);MacHost.Pump();
                Assert.Contains("155.00",chart.LiveQuote.Text);Assert.Contains(loc["Quote_Push"],chart.LiveQuote.Text);
            }
            finally{chart.Deactivate();}
        }
        finally{model.Deactivate();window.Close();loc.Apply(original);theme.Apply(AppThemeMode.System);}
    }
    [AvaloniaFact]
    public async Task Options_strategy_and_news_share_current_prices_without_rewriting_chain_valuation_or_position_drafts()
    {
        MacHost.EnsureComposed();var hub=AppServices.Get<QuoteHub>();var window=new Window{Width=1920,Height=1080};
        var options=AppServices.Get<OptionsViewModel>();var strategy=AppServices.Get<StrategyViewModel>();var news=AppServices.Get<NewsViewModel>();
        var context=AppServices.Get<SymbolContext>();var oldSymbol=context.Current;context.Set("AAPL");
        var theme=AppServices.Get<MacTheme>();theme.Apply(AppThemeMode.Dark);
        void Push(double price)=>hub.ApplyTicks([new("AAPL",price,DateTimeOffset.UtcNow,MarketState.Regular,Source:"yahoo")]);
        try
        {
            window.Content=new OptionsPage();window.Show();options.SymbolText="AAPL";await options.ActivateAsync();MacHost.Pump();var optionSpot=options.Spot;
            Push(401);MacHost.Pump();Assert.Contains("401.00",options.LivePriceText);Assert.Equal(optionSpot,options.Spot);MacHost.Save(window,"yahoo-push-options-1080p");options.Deactivate();
            window.Content=new StrategyPage();strategy.SymbolText="AAPL";await strategy.ActivateAsync();MacHost.Pump();var strategySpot=strategy.Spot;var premiums=strategy.Legs.Select(l=>l.PremiumText).ToArray();
            Push(402);MacHost.Pump();Assert.Contains("402.00",strategy.LivePriceText);Assert.Equal(strategySpot,strategy.Spot);Assert.Equal(premiums,strategy.Legs.Select(l=>l.PremiumText).ToArray());MacHost.Save(window,"yahoo-push-strategy-1080p");strategy.Deactivate();
            window.Content=new NewsPage();news.SymbolText="AAPL";await news.ActivateAsync();MacHost.Pump();Push(403);MacHost.Pump();Assert.Contains("403.00",news.LiveQuote.Text);Assert.Contains("403.00",news.Headline);MacHost.Save(window,"yahoo-push-news-1080p");news.Deactivate();
        }
        finally{options.Deactivate();strategy.Deactivate();news.Deactivate();window.Close();if(oldSymbol is not null)context.Set(oldSymbol);theme.Apply(AppThemeMode.System);}
    }

}
