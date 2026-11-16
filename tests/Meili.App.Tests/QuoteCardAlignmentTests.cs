using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Meili.App.Views.Pages;

namespace Meili.App.Tests;

public sealed class QuoteCardAlignmentTests
{
    [Fact]
    public void Quote_header_symbol_source_and_action_share_one_center()
    {
        WpfHost.Run(async()=>
        {
            foreach(var language in new[]{"zh-CN","en-US"})foreach(var dark in new[]{false,true})foreach(var width in new[]{980,1920})
            {
                ScreenRenderTests.Apply(language,dark);
                var page=new DashboardPage();using var host=new OffscreenHost(page,width,1080);
                var model=(DashboardViewModel)page.DataContext;
                try
                {
                    await model.ActivateAsync();await ScreenRenderTests.Settle();
                    var sources=UiAudit.Descendants<TextBlock>(page).Where(t=>t.DataContext is QuoteCardViewModel q && t.Text==q.SourceText && VisualTreeHelper.GetParent(t) is Border).ToArray();
                    Assert.NotEmpty(sources);
                    foreach(var source in sources)
                    {
                        var badge=(Border)VisualTreeHelper.GetParent(source);var row=(DockPanel)VisualTreeHelper.GetParent(badge);
                        var symbol=row.Children.OfType<TextBlock>().Single();var action=row.Children.OfType<Button>().Single();
                        double Center(FrameworkElement c)=>c.TranslatePoint(new Point(0,c.ActualHeight/2),row).Y;
                        Assert.InRange(Math.Abs(Center(source)-Center(badge)),0,1);
                        Assert.InRange(Math.Abs(Center(symbol)-Center(action)),0,1);
                        Assert.InRange(Math.Abs(Center(badge)-Center(action)),0,1);
                    }
                }
                finally{model.Deactivate();}
            }
        });
    }
}
