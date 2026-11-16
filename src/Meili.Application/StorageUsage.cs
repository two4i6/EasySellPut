namespace Meili.Caching;

public sealed record StorageCategory(string Id, long Bytes, long Files);
public sealed record StorageUsage(long TotalBytes, IReadOnlyList<StorageCategory> Categories, bool Complete, int Skipped, string Basis = "logical-file-bytes-in-data-directory");

/// <summary>Bounded read-only inventory. Never follows links or exposes file names, cookies or file contents.</summary>
public static class StorageInventory
{
    public const int MaxEntries = 200_000;
    private static readonly string[] UserFiles = ["settings.json", "alerts.json", "drawings.json", "strategies.json", "watchlists.json", "bookmarks.json"];
    public static StorageUsage Scan(string directory, CancellationToken ct = default, int entryLimit = MaxEntries)
    {
        if (entryLimit is < 1 or > MaxEntries) throw new ArgumentOutOfRangeException(nameof(entryLimit));
        var totals = new Dictionary<string, (long Bytes, long Files)> { ["market"] = default, ["gex"] = default, ["browser"] = default, ["userdata"] = default, ["logs"] = default, ["cache"] = default, ["other"] = default };
        var skipped = 0; var examined = 0;
        var pending = new Stack<(string Path, string Relative, int Depth)>(); pending.Push((directory, "", 0));
        ct.ThrowIfCancellationRequested();
        if (!Directory.Exists(directory))
        {
            var complete = false;
            try { _ = File.GetAttributes(directory); }
            catch (DirectoryNotFoundException) { complete = true; }
            catch (FileNotFoundException) { complete = true; }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            return new(0, totals.Select(x => new StorageCategory(x.Key, 0, 0)).ToArray(), complete, complete ? 0 : 1);
        }
        while (pending.TryPop(out var folder))
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                if ((File.GetAttributes(folder.Path) & FileAttributes.ReparsePoint) != 0) { skipped++; continue; }
                foreach (var path in Directory.EnumerateFileSystemEntries(folder.Path))
                {
                    ct.ThrowIfCancellationRequested();
                    if (++examined > entryLimit) { skipped++; pending.Clear(); break; }
                    try
                    {
                        var attributes = File.GetAttributes(path);
                        if ((attributes & FileAttributes.ReparsePoint) != 0) { skipped++; continue; }
                        var relative = folder.Relative.Length == 0 ? Path.GetFileName(path) : folder.Relative + "/" + Path.GetFileName(path);
                        if ((attributes & FileAttributes.Directory) != 0)
                        {
                            if (folder.Depth < 32) pending.Push((path, relative, folder.Depth + 1)); else skipped++;
                            continue;
                        }
                        var bytes = new FileInfo(path).Length; var id = Classify(relative); var old = totals[id];
                        totals[id] = (checked(old.Bytes + bytes), old.Files + 1);
                    }
                    catch (IOException) { skipped++; }
                    catch (UnauthorizedAccessException) { skipped++; }
                }
            }
            catch (IOException) { skipped++; }
            catch (UnauthorizedAccessException) { skipped++; }
        }
        var categories = totals.Select(x => new StorageCategory(x.Key, x.Value.Bytes, x.Value.Files)).ToArray();
        return new(categories.Sum(x => x.Bytes), categories, skipped == 0, skipped);
    }
    private static string Classify(string path)
    {
        var p = path.ToLowerInvariant();
        if (p is "cache/market.db" or "cache/market.db-wal" or "cache/market.db-shm") return "market";
        if (p.StartsWith("cache/qqq-gex")) return "gex";
        if (p.StartsWith("browser/")) return "browser";
        if (p.StartsWith("logs/") || p.StartsWith("log/") || p.EndsWith(".log")) return "logs";
        if (p.StartsWith("cache/")) return "cache";
        if (UserFiles.Any(n => p == n || p.StartsWith(n + "."))) return "userdata";
        return "other";
    }
}
