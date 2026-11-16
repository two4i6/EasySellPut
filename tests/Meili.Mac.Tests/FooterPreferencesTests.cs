using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.VisualTree;
using Meili.Core.Settings;
using Meili.Mac.Platform;
using Meili.Mac.Views;
namespace Meili.Mac.Tests;
public sealed class FooterPreferencesTests
{
    [AvaloniaTheory]
    [InlineData("zh-CN", false)]
    [InlineData("en-US", true)]
    public void Motion_setting_applies_immediately_persists_and_footer_has_only_primary_preferences(string language, bool dark)
    {
        MacHost.EnsureComposed(); var loc = AppServices.Get<LocalizationService>(); var original = loc.Language;
        var theme = AppServices.Get<MacTheme>(); var workspace = AppServices.Get<WebWorkspace>(); var old = workspace.ReduceMotion;
        var window = new MainWindow { Width = 1920, Height = 1080 }; window.Show();
        try
        {
            loc.Apply(language); theme.Apply(dark ? AppThemeMode.Dark : AppThemeMode.Light); window.Navigate(AppPage.Settings); MacHost.Pump();
            Assert.Null(window.FindControl<Control>("BackgroundButton")); Assert.Null(window.FindControl<Control>("MotionButton"));
            var page = (SettingsPage)window.CurrentView!; var box = page.FindControl<CheckBox>("ReduceMotionSetting")!;
            var model = (SettingsViewModel)page.DataContext!;
            box.IsChecked = !old; MacHost.Pump(); Assert.Equal(!old, model.ReduceMotionEnabled);
            Assert.Equal(!old, new WebWorkspace(MacHost.DataDir).ReduceMotion); Assert.Equal(DesignMotion.Reduced, window.Classes.Contains("ReducedMotion"));
            if (!old) Assert.True(DesignMotion.Reduced);
            Assert.DoesNotContain(window.FindControl<Border>("BottomStatusBar")!, box.GetVisualAncestors());
            MacHost.Save(window, $"footer-preferences-1080p-{language}-{dark}");
            window.Width = 980; MacHost.Pump(); Assert.True(box.Bounds.Width > 0);
        }
        finally { workspace.SetReduceMotion(old); window.Close(); loc.Apply(original); theme.Apply(AppThemeMode.System); }
    }
}
