using Meili.Core.Settings;
using Meili.Shared.ViewModels;

namespace Meili.Shared.Tests;

[Collection(nameof(UiPlatformCollection))]
public sealed class AppManagementLanguageTests
{
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
