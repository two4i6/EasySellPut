using Meili.Caching;
namespace Meili.Automation.Tests;
public sealed class StorageInventoryTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "storage-inventory-" + Guid.NewGuid().ToString("N"));
    private void FileOf(string relative, int length) { var p = Path.Combine(_dir, relative); Directory.CreateDirectory(Path.GetDirectoryName(p)!); File.WriteAllBytes(p, new byte[length]); }
    public void Dispose() { if (Directory.Exists(_dir)) Directory.Delete(_dir, true); }
    [Fact] public void Categories_include_all_regular_files_without_confusing_database_history_with_disposable_cache()
    {
        FileOf("cache/qqq-gex.db", 25);FileOf("cache/market.db", 100); FileOf("cache/market.db-wal", 20); FileOf("cache/other.bin", 30);
        FileOf("browser/webview2/profile", 40); FileOf("settings.json", 50); FileOf("drawings.json.bak", 10); FileOf("logs/app.log", 60); FileOf("other.bin", 70);
        var usage = StorageInventory.Scan(_dir); Assert.True(usage.Complete); Assert.Equal(405, usage.TotalBytes);
        Assert.Equal(120, usage.Categories.Single(x => x.Id == "market").Bytes);
        Assert.Equal(60, usage.Categories.Single(x => x.Id == "userdata").Bytes);
        Assert.Equal(usage.TotalBytes, usage.Categories.Sum(x => x.Bytes));
        Assert.Equal(9, usage.Categories.Sum(x => x.Files));Assert.Equal(25,usage.Categories.Single(x=>x.Id=="gex").Bytes);
    }
    [Fact] public void Bounded_scan_and_cancellation_do_not_claim_complete_totals()
    {
        FileOf("a.bin", 100); FileOf("b.bin", 100); FileOf("c.bin", 100);
        var usage = StorageInventory.Scan(_dir, entryLimit: 1); Assert.False(usage.Complete); Assert.True(usage.Skipped > 0); Assert.Equal(100, usage.TotalBytes);
        using var cts = new CancellationTokenSource(); cts.Cancel(); Assert.Throws<OperationCanceledException>(() => StorageInventory.Scan(_dir, cts.Token));
    }
    [Fact] public void Linked_folders_are_skipped_and_never_count_an_external_directory()
    {
        if (OperatingSystem.IsWindows()) return; // Creating links requires privileges unavailable on some Windows runners.
        var external = Directory.CreateTempSubdirectory("outside-storage-").FullName;
        try
        {
            File.WriteAllBytes(Path.Combine(external, "external.bin"), new byte[1000]); Directory.CreateDirectory(_dir);
            Directory.CreateSymbolicLink(Path.Combine(_dir, "linked"), external);
            var usage = StorageInventory.Scan(_dir); Assert.False(usage.Complete); Assert.Equal(0, usage.TotalBytes); Assert.Equal(1, usage.Skipped);
            Directory.Delete(Path.Combine(_dir, "linked"));
        }
        finally { Directory.Delete(external, true); }
    }
}
