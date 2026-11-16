using System.Windows.Controls;
using Meili.App.Services;
using Meili.App.Views.Controls;
using Meili.App.Views.Pages;
namespace Meili.App.Tests;

public sealed class CachePanelTests
{
    [Fact] public void Cache_controls_bind_to_registered_manager_in_both_languages_and_themes()
    {
        WpfHost.Run(async () =>
        {
            foreach (var language in new[] { "zh-CN", "en-US" }) foreach (var dark in new[] { false, true })
            {
                ScreenRenderTests.Apply(language, dark); var page = new SettingsPage(); using var host = new OffscreenHost(page, 1920, 1080);
                await ScreenRenderTests.Settle(); var vm = (SettingsViewModel)page.DataContext;
                await vm.RefreshCacheCommand.ExecuteAsync(null); await ScreenRenderTests.Settle();
                var panel = (AppCard)page.FindName("CachePanel"); Assert.NotNull(panel); panel.BringIntoView();
                var storage = (AppStorageBar)page.FindName("StorageUsageBar"); Assert.NotNull(storage); Assert.Equal(6, storage.Segments!.Count);
                var select = UiAudit.Descendants<AppSelect>(panel).Single(); select.SelectedIndex = 2;
                await ScreenRenderTests.Settle(); Assert.Equal(2, vm.CacheCategoryIndex);
                Assert.Single(UiAudit.Descendants<AppHelp>(panel));
                Assert.Contains(AppServices.Get<LocalizationService>()["Cache_bars"], vm.CacheSummary);
                await vm.ClearExpiredCacheCommand.ExecuteAsync(null); Assert.False(vm.IsCacheBusy); Assert.NotEmpty(vm.CacheFeedback);
                Assert.True(((Button)page.FindName("ClearManagedCache")).IsEnabled);
            }
        });
    }
}
