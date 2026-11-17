using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using Meili.App.Services;
using Meili.App.Views.Pages;
using Meili.Automation.Modules;
namespace Meili.App.Tests;
public sealed class ModuleNavigationTests
{
    [Fact] public void Module_navigation_is_single_selection_and_releases_hidden_pages()
    {
        WpfHost.Run(async()=>
        {
            var path=System.IO.Path.Combine(AppServices.DataDirectory.Path,"apps","registry.json");System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path)!);var old=System.IO.File.Exists(path)?System.IO.File.ReadAllBytes(path):null;
            var window=new MainWindow();
            try
            {
                System.IO.File.WriteAllText(path,System.Text.Json.JsonSerializer.Serialize(new ModuleRegistryState(1,1,[new("easysellput.preview","1.0.0",new string('A',64),1,true,true)]),new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web)));
                window.Show();await AppServices.Get<Meili.Shared.ViewModels.AppManagementViewModel>().RefreshAppsCommand.ExecuteAsync(null);await ScreenRenderTests.Settle();
                window.OpenModule("easysellput.preview");await ScreenRenderTests.Settle();
                var rail=(StackPanel)window.FindName("BuiltinRail");var tile=rail.Children.OfType<ToggleButton>().Single(t=>Equals(t.Tag,"app:easysellput.preview"));
                Assert.True(tile.IsChecked);Assert.False(((ToggleButton)window.FindName("HomeWorkspace")).IsChecked);
                var host=(ContentControl)window.FindName("ModuleAppHost");Assert.NotNull(host.Content);
                window.Hide();await ScreenRenderTests.Settle();Assert.Null(host.Content);window.Show();await ScreenRenderTests.Settle();Assert.NotNull(host.Content);
                window.NavigateForSmoke(typeof(SettingsPage));await ScreenRenderTests.Settle();Assert.Null(host.Content);
            }
            finally
            {
                window.Close();if(old is null)System.IO.File.Delete(path);else System.IO.File.WriteAllBytes(path,old);
                await AppServices.Get<Meili.Shared.ViewModels.AppManagementViewModel>().RefreshAppsCommand.ExecuteAsync(null);
            }
        });
    }
}
