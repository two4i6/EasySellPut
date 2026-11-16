using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.VisualTree;
using Meili.Core.Settings;
using Meili.Mac.Platform;
using Meili.Mac.Views;
using Meili.Mac.Views.Controls;
namespace Meili.Mac.Tests;

public sealed class CachePanelTests
{
    private sealed class Services(Meili.Caching.CacheManager manager) : IServiceProvider
    {
        public object? GetService(Type type) => type == typeof(Meili.Caching.CacheManager) ? manager : AppServices.Provider!.GetService(type);
    }
    [AvaloniaTheory]
    [InlineData("zh-CN", false)]
    [InlineData("en-US", true)]
    public async Task Cache_panel_uses_registered_service_and_shared_controls_at_fullHD_and_compact(string language, bool dark)
    {
        MacHost.EnsureComposed(); var loc = AppServices.Get<LocalizationService>(); var original = loc.Language;
        var theme = AppServices.Get<MacTheme>(); var window = new MainWindow { Width = 1920, Height = 1080 };
        var directory = Path.Combine(Path.GetTempPath(), "storage-preview-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(directory, "browser")); Directory.CreateDirectory(Path.Combine(directory, "logs"));
        File.WriteAllBytes(Path.Combine(directory, "browser", "fixture.bin"), new byte[96 * 1024]);
        File.WriteAllBytes(Path.Combine(directory, "logs", "fixture.log"), new byte[32 * 1024]);
        File.WriteAllBytes(Path.Combine(directory, "fixture.bin"), new byte[8 * 1024]);
        var store = new Meili.Core.Settings.SettingsStore(directory); store.Save();
        var gex = new Meili.Data.Cache.QqqGexResponseStore(Path.Combine(directory,"cache","qqq-gex.db"));var retainedBytes=new byte[]{1,2,3,4};var retainedHash=gex.RecordProviderBody("fixture",retainedBytes,DateTimeOffset.UtcNow,DateTimeOffset.UtcNow);
        var manager = new Meili.Caching.CacheManager(directory, new Meili.Data.Http.ResponseCache(),
            new Meili.Caching.BarCacheResource(new Meili.Data.Cache.MarketDb(Path.Combine(directory, "cache", "market.db"))),gex);
        try
        {
            loc.Apply(language); theme.Apply(dark ? AppThemeMode.Dark : AppThemeMode.Light);
            window.Show(); window.Navigate(AppPage.Settings);
            var page = (SettingsPage)window.CurrentView!; var model = new SettingsViewModel(store, loc, theme, new(directory, DataDirectorySource.CommandLine), new Services(manager)); page.DataContext = model;
            await model.RefreshCacheCommand.ExecuteAsync(null); MacHost.Pump();
            var panel = page.FindControl<AppCard>("CachePanel")!; panel.BringIntoView(); MacHost.Pump();
            Assert.NotNull(panel); Assert.Contains(loc["Cache_bars"], model.CacheSummary);
            Assert.Equal(new[]{"market","gex","browser","userdata","logs","cache","other"},model.StorageSegments.Select(s=>s.Id)); Assert.InRange(model.StorageSegments.Sum(s => s.Fraction), .999999, 1.000001);
            Assert.NotNull(page.FindControl<AppStorageBar>("StorageUsageBar"));
            Assert.Single(panel.GetVisualDescendants().OfType<AppHelp>());
            var select = panel.GetVisualDescendants().OfType<AppSelect>().Single(); select.SelectedIndex = 2; MacHost.Pump(); Assert.Equal(2, model.CacheCategoryIndex);
            var clear = page.FindControl<Button>("ClearManagedCache")!; Assert.True(clear.IsEffectivelyEnabled);
            await model.ClearExpiredCacheCommand.ExecuteAsync(null); MacHost.Pump(); Assert.False(model.IsCacheBusy); Assert.NotEmpty(model.CacheFeedback);
            Assert.True(page.FindControl<Button>("CompactGexCache")!.IsEffectivelyEnabled);await model.CompactGexCacheCommand.ExecuteAsync(null);MacHost.Pump();Assert.Equal(loc["Cache_Compacted"],model.CacheFeedback);Assert.Equal(retainedBytes,gex.ReadProviderBody(retainedHash));
            page.GetVisualDescendants().OfType<ScrollViewer>().First().Offset = new Avalonia.Vector(0, double.MaxValue); MacHost.Pump();
            MacHost.Save(window, $"cache-management-1080p-{language}-{dark}");
            window.Width = 980; MacHost.Pump(); panel.BringIntoView(); MacHost.Pump();
            Assert.True(clear.Bounds.Width > 0); Assert.True(clear.IsEffectivelyEnabled);
        }
        finally { window.Close(); loc.Apply(original); theme.Apply(AppThemeMode.System); Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); Directory.Delete(directory, true); }
    }
}
