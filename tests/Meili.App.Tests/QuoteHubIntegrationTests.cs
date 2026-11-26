using Meili.App.Services;
using Meili.Core.Abstractions;
using Meili.Core.Quotes;
using Meili.Core.Settings;
using Microsoft.Extensions.DependencyInjection;
using System.IO;

namespace Meili.App.Tests;

/// <summary>C1: pages share quotes through the hub instead of polling separately.</summary>
public class QuoteHubIntegrationTests
{
    [Fact]
    public void Pages_share_one_fetch_and_follow_the_pump()
    {
        WpfHost.Run(async () =>
        {
            // WPF resources are shared, but this test's subscription owners must not be
            // inherited from a previously activated chart/options page in another test.
            var directory=Path.Combine(Path.GetTempPath(),"esp-quote-owners-"+Guid.NewGuid().ToString("N"));
            try
            {
            var services=new ServiceCollection();
            SharedComposition.Register(services,new(directory,DataDirectorySource.CommandLine),new LocalizationService());
            var fake=new FakeMarketDataService();
            services.AddSingleton<IMarketDataService>(fake);
            services.AddSingleton<INetworkController>(new FakeNetwork());
            services.AddSingleton<ILiquiditySeriesSource>(new Meili.Testing.LiquidityFixture());
            services.AddSingleton(sp=>new MarketLiquidityService(sp.GetRequiredService<ILiquiditySeriesSource>(),fake,Meili.Testing.LiquidityFixture.Clock));
            using var provider=services.BuildServiceProvider();provider.GetRequiredService<SettingsStore>().Load();
            var hub = provider.GetRequiredService<QuoteHub>();
            var watch = provider.GetRequiredService<WatchlistViewModel>();
            var dash = provider.GetRequiredService<DashboardViewModel>();
            try
            {
            await watch.ActivateAsync();
            var afterWatch = fake.QuoteCalls;
            await dash.ActivateAsync();                       // same symbols, inside the TTL: no new request
            Assert.Equal(afterWatch, fake.QuoteCalls);
            Assert.All(dash.Quotes, c => Assert.NotEqual("—", c.PriceText));

            await hub.PollAsync();                            // the app-level tick: exactly one request for both pages
            Assert.Equal(afterWatch + 1, fake.QuoteCalls);

            }
            finally { dash.Deactivate();watch.Deactivate(); }
            Assert.Empty(hub.SubscribedSymbols);                // hidden pages stop asking (alerts are off in tests)
            }
            finally { Directory.Delete(directory,true); }
        });
    }
}
