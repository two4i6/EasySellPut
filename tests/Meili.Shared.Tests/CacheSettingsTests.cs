using Meili.Caching;
using Meili.Core.Settings;
using Meili.Data.Cache;
using Meili.Data.Http;
using Meili.Shared.ViewModels;
namespace Meili.Shared.Tests;

[Collection(nameof(UiPlatformCollection))]
public sealed class CacheSettingsTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "cache-vm-" + Guid.NewGuid().ToString("N"));
    private sealed class Theme : IThemeController { public void Apply(AppThemeMode mode) { } public void ApplyUpDownColors(UpDownColorMode mode) { } }
    private sealed class Services(CacheManager manager) : IServiceProvider { public object? GetService(Type type) => type == typeof(CacheManager) ? manager : null; }
    public void Dispose() { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); if (Directory.Exists(_dir)) Directory.Delete(_dir, true); }
    [Fact] public async Task Selected_clear_requires_confirmation_expired_clear_keeps_live_data_and_commands_recover()
    {
        var cache = new ResponseCache(); cache.Set("live", "value", TimeSpan.FromMinutes(5)); cache.Set("expired", "value", TimeSpan.FromSeconds(-1));
        var manager = new CacheManager(_dir, cache, new BarCacheResource(new MarketDb(Path.Combine(_dir, "cache", "market.db"))));
        var ui = new FakeUiPlatform { ConfirmAnswer = false }; Ui.Platform = ui;
        var vm = new SettingsViewModel(new(_dir), new(), new Theme(), new(_dir, DataDirectorySource.CommandLine), new Services(manager));
        await vm.RefreshCacheCommand.ExecuteAsync(null); Assert.Contains("2", vm.CacheSummary); Assert.Equal(6, vm.StorageSegments.Count); Assert.NotEqual("—", vm.StorageTotal);
        vm.CacheCategoryIndex = 1; await vm.ClearCacheCommand.ExecuteAsync(null); Assert.Equal(2, cache.Inspect().Entries); Assert.False(vm.IsCacheBusy);
        await vm.ClearExpiredCacheCommand.ExecuteAsync(null); Assert.Equal(1, cache.Inspect().Entries);
        ui.ConfirmAnswer = true; await vm.ClearCacheCommand.ExecuteAsync(null); Assert.Equal(0, cache.Inspect().Entries);
        Assert.True(vm.ClearCacheCommand.CanExecute(null)); Assert.NotEmpty(vm.CacheFeedback);
    }
}
