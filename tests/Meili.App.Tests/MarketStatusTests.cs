using System.Windows;
using System.Windows.Controls;
using Meili.Shared.Tests;
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
            using var update = new UpdateViewModel(new(WpfHost.DataDir), AppServices.Get<LocalizationService>(), AppServices.DataDirectory, new FakeUpdates());
            try
            {
                w.UseUpdateState(update); w.Show(); await update.CheckUpdatesCommand.ExecuteAsync(null); update.DismissUpdatePromptCommand.Execute(null); await ScreenRenderTests.Settle();
                var shell = AppServices.Get<ShellViewModel>(); var status = (Button)w.FindName("MarketStatusIndicator");
                Assert.Equal(shell.MarketStatusTip, status.ToolTip);
                Assert.Equal(shell.MarketStatusTip, System.Windows.Automation.AutomationProperties.GetName(status));
                Assert.InRange(status.ActualWidth, 40, 220);
                AssertAlignment(w);
                status.Command.Execute(null); await ScreenRenderTests.Settle();
                Assert.Contains(UiAudit.Descendants<Meili.App.Views.Pages.DataSourcesPage>(w), page => page.IsVisible);
                Assert.DoesNotContain(((StackPanel)w.FindName("BuiltinRail")).Children.OfType<System.Windows.Controls.Primitives.ToggleButton>(), tile => Equals(tile.Tag, AppPage.DataSources));
                w.Width = 980; await ScreenRenderTests.Settle();
                Assert.InRange(status.ActualWidth, 40, 220); AssertAlignment(w);
            }
            finally { w.Close(); }
        });
    }
    private static void AssertAlignment(MainWindow w)
    {
        var bar = (Border)w.FindName("StatusBarSurface");
        double Center(FrameworkElement c) => c.TranslatePoint(new Point(0, c.ActualHeight / 2), bar).Y;
        var names = new[] { "StatusMarketText", "StatusClockText", "StatusMcpText", "StatusUpdateText" };
        var center = Center((TextBlock)w.FindName(names[0]));
        foreach (var name in names)
        {
            var text = (TextBlock)w.FindName(name);
            Assert.True(text.IsVisible); Assert.InRange(Math.Abs(Center(text) - center), 0, 0.75);
            Assert.InRange(Math.Abs(text.ActualHeight - DesignTokens.StatusLineHeight), 0, 0.75);
        }
        Assert.InRange(Math.Abs(center - bar.ActualHeight / 2), 0, 0.75);
        foreach (var icon in UiAudit.Descendants<LucideIcon>(bar)) Assert.InRange(Math.Abs(Center(icon) - center), 0, 0.75);
        foreach (var dot in UiAudit.Descendants<System.Windows.Shapes.Ellipse>(bar)) Assert.InRange(Math.Abs(Center(dot) - center), 0, 0.75);
        foreach (var name in new[] { "MarketStatusIndicator", "McpStatusIndicator", "UpdateStatusIndicator", "SettingsButton", "LanguageButton", "ThemeButton" })
            Assert.InRange(Math.Abs(Center((FrameworkElement)w.FindName(name)) - center), 0, 0.75);
    }
}
