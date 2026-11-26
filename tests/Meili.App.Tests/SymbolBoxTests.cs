using Meili.App.Services;
using CommunityToolkit.Mvvm.Input;
using Meili.App.Views.Controls;

namespace Meili.App.Tests;

/// <summary>D3: shared symbol box — text sync, suggestions from watch list + search, commit. Never shown on screen.</summary>
public class SymbolBoxTests
{
    [Fact]
    public void Suggests_watchlist_then_search_hits_and_commits_the_pick()
    {
        WpfHost.Run(async () =>
        {
            var commits = 0;
            var box = new SymbolBox
            {
                WatchSymbols = new[] { "AAPL", "MSFT", "AMZN" },
                CommitCommand = new RelayCommand(() => commits++),
            };
            box.Text = "a";
            await box.RefreshAsync(showAll: false, open: true);
            Assert.Equal("AAPL", box.Items[0].Symbol);
            Assert.True(box.Items[0].FromWatchlist);
            Assert.Contains(box.Items, i => i.Symbol == "A" && !i.FromWatchlist);   // the fake search echoes the query
            Assert.False(box.NoMatch);

            await box.RefreshAsync(showAll: true, open: true);
            Assert.Equal(["AAPL", "MSFT", "AMZN"], box.Items.Select(i => i.Symbol));

            box.Pick(box.Items[1]);
            Assert.Equal("MSFT", box.Text);
            Assert.Equal(1, commits);
        });
    }

    [Fact]
    public void Pages_bind_their_symbol_through_the_shared_box()
    {
        WpfHost.Run(async () =>
        {
            var context = AppServices.Get<Meili.Shared.Services.SymbolContext>();
            var options = AppServices.Get<Meili.Shared.ViewModels.OptionsViewModel>();
            var page = new Meili.App.Views.Pages.OptionsPage();
            using var host = new OffscreenHost(page, 1280, 800);
            await WpfHost.Settle();
            var workspace = (MarketWorkspaceLayout)page.FindName("Workspace");
            var box = (SymbolBox)workspace.FindName("SymbolInput");
            context.Set("NVDA");
            Assert.Equal("NVDA", box.Text);
            box.Text = "AMD";
            box.CommitCommand!.Execute(null);
            Assert.Equal("AMD", context.Current);
            Assert.Equal("AMD", options.SymbolText);
        });
    }
}
