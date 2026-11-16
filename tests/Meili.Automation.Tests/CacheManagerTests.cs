using System.Text.Json;
using Meili.Caching;
using Meili.Automation;
using Meili.Core.Models;
using Meili.Core.Settings;
using Meili.Data.Cache;
using Meili.Data.Http;
using Microsoft.Data.Sqlite;
namespace Meili.Automation.Tests;

public sealed class CacheManagerTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "cache-service-" + Guid.NewGuid().ToString("N"));
    private MarketDb Db() => new(Path.Combine(_directory, "cache", "market.db"));
    public void Dispose() { SqliteConnection.ClearAllPools(); if (Directory.Exists(_directory)) Directory.Delete(_directory, true); }
    [Fact] public void Management_is_allowlisted_protects_user_files_and_expired_mode_retains_bars()
    {
        var db = Db(); var now = DateTimeOffset.UtcNow;
        db.SaveBars("AAPL", BarInterval.Day1, [new(now, 1, 2, .5, 1.5, 10)], new("fixture", now, now, 0, false));
        var settings = new SettingsStore(_directory); settings.Save(); var before = File.ReadAllBytes(settings.FilePath);
        var cache = new ResponseCache(); cache.Set("expired", "x", TimeSpan.FromSeconds(-1));
        var manager = new CacheManager(cache, new BarCacheResource(db));
        Assert.Contains("iv_samples", manager.Inspect().ProtectedData);
        Assert.Throws<ArgumentException>(() => manager.Clear("../cache"));
        Assert.Throws<ArgumentException>(() => manager.Clear("all", symbol: "AAPL"));
        manager.Clear("all", true); Assert.Single(db.LoadBars("AAPL", BarInterval.Day1).Bars); Assert.Equal(0, cache.Inspect().Entries);
        manager.Clear("bars", symbol: "aapl"); Assert.Empty(db.LoadBars("AAPL", BarInterval.Day1).Bars);
        Assert.Equal(before, File.ReadAllBytes(settings.FilePath));
    }
    [Fact] public async Task Automation_is_offline_and_write_permission_is_enforced_before_any_mutation()
    {
        using var service = new AutomationService(new(_directory, DataDirectorySource.CommandLine));
        var args = JsonSerializer.SerializeToElement(new { category = "bars" });
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.ExecuteAsync("clear_cache", args, false));
        Assert.False(Directory.Exists(_directory));
        var status = await service.ExecuteAsync("get_cache_status", JsonSerializer.SerializeToElement(new { }), false);
        Assert.Equal("data-directory", status.GetProperty("data").GetProperty("caches")[1].GetProperty("scope").GetString());
        await service.ExecuteAsync("clear_cache", args, true);
        var exception = await Assert.ThrowsAsync<ArgumentException>(() => service.ExecuteAsync("clear_cache", JsonSerializer.SerializeToElement(new { category = "browser" }), true));
        Assert.NotNull(exception);
    }
}
