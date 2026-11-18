using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Headless;
using Avalonia.Input;
using Avalonia.VisualTree;
using Meili.Mac.Platform;
using Meili.Mac.Views.Controls;
namespace Meili.Mac.Tests;
public sealed class NewsSplitTests
{
    [AvaloniaFact] public async Task Articles_share_the_shell_without_modal_or_address_bar_and_resize_without_recreating_the_reader()
    {
        MacHost.EnsureComposed();var w=new MainWindow{Width=1920,Height=1080};w.Show();w.Navigate(AppPage.News);await Task.Delay(150);MacHost.Pump();var original=w.CurrentView;
        try
        {
            var page=Assert.IsType<Meili.Mac.Views.NewsPage>(original);
            var model=Assert.IsType<Meili.Shared.ViewModels.NewsViewModel>(page.DataContext);
            Assert.True(w.NewsSplit!.IsShowingDefault);
            Assert.Null(page.FindControl<Button>("NewsSection"));
            model.News.Clear();
            foreach(var title in new[]{"Reading a company’s quarterly results", "Understanding cash flow and reported earnings", "What a balance sheet can tell investors", "Comparing annual and quarterly statements", "Keeping original publication times visible"})
                model.News.Add(new Meili.Shared.ViewModels.NewsEntry{Title=title,Url="https://example.com/story-one",Publisher="UI acceptance fixture",TimeText="09:30 ET",TimeTip="Synthetic UI data; not a live article"});
            MacHost.Pump();
            var card=page.GetVisualDescendants().OfType<AppActionCard>().First(button=>button.CommandParameter is Meili.Shared.ViewModels.NewsEntry);
            Assert.NotNull(card.Command);Assert.True(card.Command!.CanExecute(card.CommandParameter));card.Command.Execute(card.CommandParameter);MacHost.Pump();
            Assert.Same(card.CommandParameter,model.SelectedNews);
            MacHost.Save(w,"news-fundamentals-default-1920");
            w.OpenNewsArticle("https://example.com/story-one","Fixture article");MacHost.Pump();
            Assert.False(w.NewsSplit!.IsShowingDefault);
            Assert.Empty(w.OwnedWindows);Assert.True(w.NewsSplit!.IsOpen);Assert.False(w.NewsSplit.IsVertical);
            var browser=Assert.Single(w.NewsSplit.GetVisualDescendants().OfType<WebTabPane>());
            Assert.Empty(browser.GetVisualDescendants().OfType<TextBox>());
            Assert.Equal(3,browser.GetVisualDescendants().OfType<Button>().Count());
            Assert.Contains(browser.GetVisualDescendants().OfType<TextBlock>(),t=>t.Text=="example.com");
            MacHost.Save(w,"news-split-wide");
            w.NewsSplit.ColumnDefinitions[0].Width=new GridLength(3,GridUnitType.Star);
            w.OpenNewsArticle("https://example.com/story-two","Second fixture article");MacHost.Pump();Assert.Same(browser,Assert.Single(w.NewsSplit.GetVisualDescendants().OfType<WebTabPane>()));
            Assert.Equal(new GridLength(3,GridUnitType.Star),w.NewsSplit.ColumnDefinitions[0].Width);
            foreach(var dark in new[]{false,true})
            {
                AppServices.Get<MacTheme>().Apply(dark?Meili.Core.Settings.AppThemeMode.Dark:Meili.Core.Settings.AppThemeMode.Light);
                foreach(var width in new[]{1920,1280,980}){w.Width=width;MacHost.Pump();Assert.False(w.NewsSplit.IsVertical);MacHost.Save(w,$"news-split-{width}-{dark}");}
            }
            Assert.Throws<ArgumentException>(()=>w.OpenNewsArticle("file:///tmp/blocked","Blocked"));
            w.KeyPress(Key.Escape,RawInputModifiers.None,PhysicalKey.Escape,null);MacHost.Pump();Assert.True(w.NewsSplit.IsShowingDefault);Assert.True(w.NewsSplit.IsOpen);Assert.Same(original,w.CurrentView);
            Assert.Empty(w.NewsSplit.GetVisualDescendants().OfType<WebTabPane>());
            Assert.Equal(new GridLength(3,GridUnitType.Star),w.NewsSplit.ColumnDefinitions[0].Width);
            w.Width=1920;MacHost.Pump();MacHost.Save(w,"news-fundamentals-restored-1920");
        }
        finally{w.AllowClose();w.Close();}
    }
}
