using System.Windows;
using Meili.App.Services;
using Meili.App.Views.Controls;
namespace Meili.App.Tests;
public sealed class MarketStatusTests
{
    [Theory]
    [InlineData("zh-CN", false)]
    [InlineData("en-US", true)]
    public void Market_and_source_health_share_a_single_accessible_entry(string language, bool dark)
    {
        WpfHost.Run(async () =>
        {
            ScreenRenderTests.Apply(language, dark); var w = new MainWindow { Width = 1920, Height = 1080 };
            try
            {
                w.Show(); await ScreenRenderTests.Settle();
                var shell = AppServices.Get<ShellViewModel>(); var status = (AppHelp)w.FindName("MarketStatusIndicator");
                Assert.Equal(shell.MarketStatusTip, status.HelpText);
                Assert.Equal(shell.MarketStatusTip, System.Windows.Automation.AutomationProperties.GetName(status));
                Assert.InRange(status.ActualWidth, 40, 220);
                status.IsExpanded = true; await WpfHost.Settle(); Assert.True(status.IsHelpOpen);
                status.IsExpanded = false; w.Width = 980; await ScreenRenderTests.Settle();
                Assert.InRange(status.ActualWidth, 40, 220); Assert.False(status.IsExpanded);
            }
            finally { w.Close(); }
        });
    }
}
