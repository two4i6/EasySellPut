using Meili.App.Services;
using Meili.App.Views.Controls;
using Meili.App.Views.Pages;
namespace Meili.App.Tests;
public sealed class ApplicationPanelTests
{
    [Fact] public void App_manager_reuses_controls_and_disables_actions_without_selection()
    {
        WpfHost.Run(async()=>
        {
            foreach(var language in new[]{"zh-CN","en-US"})foreach(var dark in new[]{false,true})
            {
                ScreenRenderTests.Apply(language,dark);var page=new SettingsPage();using var host=new OffscreenHost(page,1920,1080);await ScreenRenderTests.Settle();
                var vm=((SettingsViewModel)page.DataContext).Applications;await vm.RefreshAppsCommand.ExecuteAsync(null);await ScreenRenderTests.Settle();
                var panel=(AppCard)page.FindName("ApplicationsPanel");Assert.NotNull(panel);
                Assert.Single(UiAudit.Descendants<AppSelect>(panel));Assert.Single(UiAudit.Descendants<AppHelp>(panel));
                if(vm.SelectedApp is null){Assert.False(vm.ToggleAppCommand.CanExecute(null));Assert.False(vm.UninstallAppCommand.CanExecute(null));}
                Assert.True(vm.InstallAppCommand.CanExecute(null));Assert.False(vm.IsBusy);
            }
        });
    }
}
