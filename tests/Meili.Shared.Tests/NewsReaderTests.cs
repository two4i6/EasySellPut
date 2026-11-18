using Meili.Core.Settings;
using Meili.Shared.ViewModels;

namespace Meili.Shared.Tests;

[Collection(nameof(UiPlatformCollection))]
public sealed class NewsReaderTests
{
    [Theory]
    [InlineData("https://example.com/news?id=1", true)]
    [InlineData("http://127.0.0.1:1234/article", true)]
    [InlineData("javascript:alert(1)", false)]
    [InlineData("file:///etc/passwd", false)]
    [InlineData("mailto:someone@example.com", false)]
    [InlineData("https://user:password@example.com/article", false)]
    [InlineData("/relative", false)]
    [InlineData(null, false)]
    public void Reader_accepts_only_web_urls_without_credentials(string? url, bool allowed) =>
        Assert.Equal(allowed, NewsReaderPolicy.IsAllowed(url));

    [Fact]
    public async Task Late_news_cannot_replace_a_new_symbol_or_hidden_page()
    {
        Ui.Platform=new FakeUiPlatform();
        var directory=Path.Combine(Path.GetTempPath(),"news-generation-"+Guid.NewGuid().ToString("N"));
        var late=new TaskCompletionSource<IReadOnlyList<Meili.Core.Models.NewsItem>>(TaskCreationOptions.RunContinuationsAsynchronously);
        var data=new PricingSnapshotTests.SnapshotData{News=(symbol,_)=>symbol=="AAPL"?late.Task:Task.FromResult<IReadOnlyList<Meili.Core.Models.NewsItem>>([new(){Title="new symbol",Source="fixture",Url="https://example.com/fixture"}])};
        var model=new NewsViewModel(new WatchlistStore(new SettingsStore(directory)),data,new LocalizationService(),new SymbolContext());
        try
        {
            model.SymbolText="AAPL";var previous=model.LoadAsync();
            model.SymbolText="MSFT";await model.LoadAsync();
            late.SetResult([new(){Title="stale",Source="fixture",Url="https://example.com/fixture"}]);await previous;
            Assert.Equal("new symbol",Assert.Single(model.News).Title);Assert.Equal("MSFT",model.NameText);
            var hidden=new TaskCompletionSource<IReadOnlyList<Meili.Core.Models.NewsItem>>(TaskCreationOptions.RunContinuationsAsynchronously);
            data.News=(_,_)=>hidden.Task;var pending=model.LoadAsync();model.Deactivate();
            hidden.SetResult([new(){Title="hidden stale",Source="fixture",Url="https://example.com/fixture"}]);await pending;
            Assert.Equal("new symbol",Assert.Single(model.News).Title);Assert.False(model.IsBusy);
        }
        finally{model.Deactivate();if(Directory.Exists(directory))Directory.Delete(directory,true);}
    }

    [Fact]
    public async Task Language_changes_defer_hidden_news_fetch_until_activation()
    {
        Ui.Platform=new FakeUiPlatform();var calls=0;
        var directory=Path.Combine(Path.GetTempPath(),"news-locale-"+Guid.NewGuid().ToString("N"));
        var data=new PricingSnapshotTests.SnapshotData{News=(_,_)=>{calls++;return Task.FromResult<IReadOnlyList<Meili.Core.Models.NewsItem>>([new(){Title="fixture",Url="https://example.com",Source="fixture"}]);}};
        var loc=new LocalizationService();var model=new NewsViewModel(new WatchlistStore(new SettingsStore(directory)),data,loc,new SymbolContext());
        try
        {
            await model.ActivateAsync();model.Deactivate();var before=calls;
            loc.Apply("en-US");Assert.Equal(before,calls);
            await model.ActivateAsync();Assert.True(calls>before);
        }
        finally{model.Deactivate();if(Directory.Exists(directory))Directory.Delete(directory,true);}
    }

    [Fact]
    public void News_uses_internal_reader_while_company_website_keeps_explicit_browser_behavior()
    {
        var directory = Path.Combine(Path.GetTempPath(), "meili-news-" + Guid.NewGuid().ToString("N"));
        try
        {
            var ui = new FakeUiPlatform(); Ui.Platform = ui;
            var loc = new LocalizationService();
            var vm = new NewsViewModel(new WatchlistStore(new SettingsStore(directory)),
                new PricingSnapshotTests.SnapshotData(), loc, new SymbolContext());
            vm.OpenArticleCommand.Execute(new NewsEntry { Url = "https://example.com/article", Title = "Article title" });
            Assert.Equal(("https://example.com/article", "Article title"), Assert.Single(ui.Articles));
            Assert.NotNull(vm.SelectedNews);Assert.Equal("https://example.com/article",vm.SelectedNews.Url);
            Assert.Empty(ui.Opened);
            vm.OpenArticleCommand.Execute(new NewsEntry { Url = "file:///private/file", Title = "Blocked" });
            Assert.Single(ui.Articles);
            Assert.Equal(loc["Reader_Blocked"], vm.StatusText);
            vm.WebsiteUrl = "https://example.com";
            vm.OpenWebsiteCommand.Execute(null);
            Assert.Equal("https://example.com", Assert.Single(ui.Opened));
            vm.Deactivate();
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
}
