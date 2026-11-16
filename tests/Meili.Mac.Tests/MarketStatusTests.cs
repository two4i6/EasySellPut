using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Meili.Core.Settings;
using Meili.Mac.Platform;
using Meili.Mac.Views.Controls;
namespace Meili.Mac.Tests;
public sealed class MarketStatusTests
{
    [AvaloniaTheory]
    [InlineData("zh-CN", false)]
    [InlineData("en-US", true)]
    public void Market_and_source_health_use_one_compact_help_entry(string language, bool dark)
    {
        MacHost.EnsureComposed(); var loc = AppServices.Get<LocalizationService>(); var original = loc.Language;
        var theme = AppServices.Get<MacTheme>(); loc.Apply(language); theme.Apply(dark ? AppThemeMode.Dark : AppThemeMode.Light);
        var w = new MainWindow();
        try
        {
            w.Show(); w.Width = 1920; w.Height = 1080; MacHost.Pump();
            var shell = AppServices.Get<ShellViewModel>(); var status = w.FindControl<AppHelp>("MarketStatusIndicator")!;
            Assert.Equal(shell.MarketStatusTip, status.HelpText);
            Assert.Equal(shell.MarketStatusTip, Avalonia.Automation.AutomationProperties.GetName(status));
            Assert.NotEmpty(shell.SourceCountText); Assert.InRange(status.Bounds.Width, 40, 220);
            status.IsExpanded = true; MacHost.Pump(); Assert.True(status.IsHelpOpen);
            MacHost.Save(w, $"market-status-details-{language}-{dark}");
            status.IsExpanded = false; MacHost.Pump();
            MacHost.Save(w, $"market-status-1080p-{language}-{dark}");
            w.Width = 980; MacHost.Pump(); Assert.InRange(status.Bounds.Width, 40, 220);
            Assert.False(status.IsExpanded);
        }
        finally { w.AllowClose(); w.Close(); loc.Apply(original); theme.Apply(AppThemeMode.System); }
    }
}
