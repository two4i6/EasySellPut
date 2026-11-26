using Meili.Core.Settings;
using Meili.Shared.ViewModels;

namespace Meili.Shared.Tests;

[Collection(nameof(UiPlatformCollection))]
public sealed class AppManagementLanguageTests
{
    [Fact]
    public async Task Invalid_registry_metadata_is_an_actionable_status_without_an_unhandled_UI_exception()
    {
        var directory=Path.Combine(Path.GetTempPath(),"apps-invalid-meta-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(Path.Combine(directory,"apps"));
        try
        {
            await File.WriteAllTextAsync(Path.Combine(directory,"apps","registry.json"),"{\"schemaVersion\":-1,\"generation\":0,\"apps\":[]}");
            var loc=new LocalizationService();var model=new Meili.Shared.ViewModels.AppManagementViewModel(directory,loc);
            await model.RefreshAppsCommand.ExecuteAsync(null);Assert.False(model.IsBusy);Assert.Equal(loc["Apps_Error"],model.Status);
        }
        finally{Directory.Delete(directory,true);}
    }

    [Fact]
    public async Task Existing_maintenance_status_tracks_language_without_reloading_apps()
    {
        var root = Path.Combine(Path.GetTempPath(), "apps-language-" + Guid.NewGuid());
        var loc = new LocalizationService();
        loc.Apply("zh-CN");
        var model = new AppManagementViewModel(root, loc);
        try
        {
            await model.RefreshAppsCommand.ExecuteAsync(null);
            Assert.Equal(loc["Apps_Empty"], model.Status);
            foreach (var language in new[] { "en-US", "zh-CN" })
            {
                loc.Apply(language);
                model.RefreshLanguage();
                Assert.Equal(loc["Apps_Empty"], model.Status);
                Assert.Equal(loc["Apps_Enable"], model.ToggleLabel);
                Assert.Empty(model.Apps);
                Assert.False(model.IsBusy);
            }
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, recursive: true); }
    }
}
