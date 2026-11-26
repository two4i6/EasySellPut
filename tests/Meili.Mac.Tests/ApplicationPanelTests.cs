using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.VisualTree;
using Meili.Automation.Modules;
using Meili.Core.Settings;
using Meili.Mac.Platform;
using Meili.Mac.Views;
using Meili.Mac.Views.Controls;
namespace Meili.Mac.Tests;

public sealed class ApplicationPanelTests
{
    [AvaloniaTheory]
    [InlineData("zh-CN",false)]
    [InlineData("en-US",true)]
    public async Task Shared_app_manager_preserves_selection_and_uses_existing_controls_at_1080p(string language,bool dark)
    {
        MacHost.EnsureComposed();var loc=AppServices.Get<LocalizationService>();var old=loc.Language;
        var theme=AppServices.Get<MacTheme>();var root=Path.Combine(Path.GetTempPath(),"app-panel-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(Path.Combine(root,"apps"));
        // Metadata fixture only. No executable package is trusted or run by this visual test.
        File.WriteAllText(Path.Combine(root,"apps","registry.json"),System.Text.Json.JsonSerializer.Serialize(new ModuleRegistryState(1,1,[new("easysellput.preview","1.0.0",new string('A',64),1,false)]),new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web)));
        var window=new MainWindow{Width=1920,Height=1080};
        try
        {
            loc.Apply(language);theme.Apply(dark?AppThemeMode.Dark:AppThemeMode.Light);window.Show();window.Navigate(AppPage.Settings);
            var page=(SettingsPage)window.CurrentView!;
            var model=new SettingsViewModel(new SettingsStore(root),loc,theme,new(root,DataDirectorySource.CommandLine),AppServices.Provider!);page.DataContext=model;
            await model.Applications.RefreshAppsCommand.ExecuteAsync(null);MacHost.Pump();
            Assert.Equal("easysellput.preview",model.Applications.SelectedApp?.Id);Assert.Equal(loc["Apps_Disabled"],model.Applications.SelectedStatus);
            var panel=page.FindControl<AppCard>("ApplicationsPanel")!;panel.BringIntoView();MacHost.Pump();
            Assert.Single(panel.GetVisualDescendants().OfType<AppSelect>());Assert.Single(panel.GetVisualDescendants().OfType<AppHelp>());
            Assert.True(model.Applications.ToggleAppCommand.CanExecute(null));
            await model.Applications.RefreshAppsCommand.ExecuteAsync(null);Assert.Equal("easysellput.preview",model.Applications.SelectedApp?.Id);
            MacHost.Save(window,$"applications-1080p-{language}-{dark}");
            window.Width=980;MacHost.Pump();panel.BringIntoView();MacHost.Pump();
            Assert.InRange(panel.Bounds.Width,1,980);Assert.False(model.Applications.IsBusy);
        }
        finally{window.Close();loc.Apply(old);theme.Apply(AppThemeMode.System);Directory.Delete(root,true);}
    }
}
