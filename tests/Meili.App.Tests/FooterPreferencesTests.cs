using System.Windows;
using System.Windows.Controls;
using Meili.App.Services;
using Meili.App.Views.Pages;
namespace Meili.App.Tests;
public sealed class FooterPreferencesTests
{
    [Fact] public void Reduced_motion_is_in_settings_and_removed_footer_controls_stay_absent()
    {
        WpfHost.Run(async () =>
        {
            var workspace = AppServices.Get<WebWorkspace>(); var previous = workspace.ReduceMotion; var window = new MainWindow(); window.Show();
            try
            {
                window.NavigateForSmoke(typeof(SettingsPage)); await ScreenRenderTests.Settle();
                Assert.Null(window.FindName("BackgroundButton")); Assert.Null(window.FindName("MotionButton"));
                var page = UiAudit.Descendants<SettingsPage>(window).Single(); var box = (CheckBox)page.FindName("ReduceMotionSetting");
                box.IsChecked = true; await ScreenRenderTests.Settle();
                Assert.True(((SettingsViewModel)page.DataContext).ReduceMotionEnabled); Assert.True(DesignMotion.Reduced);
                Assert.True(new WebWorkspace(AppServices.DataDirectory.Path).ReduceMotion);
            }
            finally { workspace.SetReduceMotion(previous); window.Close(); }
        });
    }
}
