using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Headless.XUnit;
using Meili.Automation.Modules;
namespace Meili.Mac.Tests;
public sealed class ModuleNavigationTests
{
    [AvaloniaFact] public async Task Module_entries_have_one_selection_release_when_hidden_and_leave_personal_tabs_intact()
    {
        MacHost.EnsureComposed();var path=Path.Combine(AppServices.DataDirectory.Path,"apps","registry.json");Directory.CreateDirectory(Path.GetDirectoryName(path)!);var old=File.Exists(path)?File.ReadAllBytes(path):null;
        var window=new MainWindow{Width=1920,Height=1080};
        try
        {
            // Navigation metadata fixture only: the missing package must show an error, never run untrusted code.
            File.WriteAllText(path,System.Text.Json.JsonSerializer.Serialize(new ModuleRegistryState(1,1,[new("easysellput.preview","1.0.0",new string('A',64),1,true,true),new("easysellput.core","1.0.0",new string('B',64),1,true,false)]),new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web)));
            window.Show();await AppServices.Get<Meili.Shared.ViewModels.AppManagementViewModel>().RefreshAppsCommand.ExecuteAsync(null);MacHost.Pump();
            var rail=window.FindControl<StackPanel>("BuiltinRail")!;var tile=rail.Children.OfType<ToggleButton>().Single(t=>Equals(t.Tag,"app:easysellput.preview"));
            Assert.DoesNotContain(rail.Children.OfType<ToggleButton>(),t=>Equals(t.Tag,"app:easysellput.core"));
            window.OpenModule("easysellput.preview");await Task.Delay(30);MacHost.Pump();
            Assert.True(tile.IsChecked);Assert.False(window.FindControl<ToggleButton>("HomeWorkspace")!.IsChecked);
            var host=window.FindControl<ContentControl>("ModuleAppHost")!;Assert.NotNull(host.Content);
            window.Hide();MacHost.Pump();Assert.Null(host.Content);window.Show();MacHost.Pump();Assert.NotNull(host.Content);
            var bookmark=new WebWorkspaceTab(Guid.NewGuid().ToString("N"),"Fixture website","https://example.com/");window.OpenWebsite(bookmark);MacHost.Pump();Assert.Null(host.Content);
            var tabs=window.FindControl<Grid>("WebTabHost")!;var browser=Assert.Single(tabs.Children);
            window.OpenModule("easysellput.preview");MacHost.Pump();window.OpenWebsite(bookmark);MacHost.Pump();Assert.Same(browser,Assert.Single(tabs.Children));
            window.Navigate(AppPage.Settings);MacHost.Pump();Assert.Null(host.Content);
        }
        finally{window.Close();if(old is null)File.Delete(path);else File.WriteAllBytes(path,old);await AppServices.Get<Meili.Shared.ViewModels.AppManagementViewModel>().RefreshAppsCommand.ExecuteAsync(null);}
    }
}
