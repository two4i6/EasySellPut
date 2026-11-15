using System.Windows.Controls;
using Meili.App.Services;
namespace Meili.App.Tests;
public sealed class NewsSplitTests
{
    [Fact] public void News_reader_is_inline_compact_reusable_and_closable()
    {
        WpfHost.Run(async()=>
        {
            using var publisher=new NewsReaderFixture();
            var w=new MainWindow{Width=1440,Height=900};w.Show();w.NavigateForSmoke(typeof(Meili.App.Views.Pages.ChartsPage));await ScreenRenderTests.Settle();
            try
            {
                w.OpenNewsArticle(publisher.Url,"本地演示新闻");await ScreenRenderTests.Settle();
                Assert.True(w.NewsSplit!.IsOpen);Assert.False(w.NewsSplit.IsVertical);
                var pane=UiAudit.Descendants<WebTabPane>(w).Single();Assert.Empty(UiAudit.Descendants<TextBox>(pane));Assert.Equal(3,UiAudit.Descendants<Button>(pane).Count());
                var deadline=DateTimeOffset.UtcNow.AddSeconds(20);while(pane.DocumentTitle!="本地演示新闻"&&DateTimeOffset.UtcNow<deadline)await Task.Delay(100);
                Assert.Equal("本地演示新闻",pane.DocumentTitle);
                w.OpenNewsArticle(publisher.Url+"?second","Second");Assert.Same(pane,UiAudit.Descendants<WebTabPane>(w).Single());
                w.Width=980;await ScreenRenderTests.Settle();Assert.True(w.NewsSplit.IsVertical);
                Assert.Throws<ArgumentException>(()=>w.OpenNewsArticle("file:///tmp/blocked","Blocked"));
                if(Environment.GetEnvironmentVariable("MEILI_RENDER_DIR") is {Length:>0} dir)
                {
                    w.Width=Math.Min(1440,System.Windows.SystemParameters.WorkArea.Width);w.Height=Math.Min(900,System.Windows.SystemParameters.WorkArea.Height);w.Left=System.Windows.SystemParameters.WorkArea.Left;w.Top=System.Windows.SystemParameters.WorkArea.Top;w.Activate();w.Topmost=true;await Task.Delay(400);
                    NewsReaderFixture.Capture(w,System.IO.Path.Combine(dir,"desktop-smoke-news-split-windows.png"));w.Topmost=false;
                }
                w.CloseNewsArticle();await ScreenRenderTests.Settle();Assert.False(w.NewsSplit.IsOpen);Assert.Empty(UiAudit.Descendants<WebTabPane>(w));
            }
            finally{w.Close();}
        });
    }
}
