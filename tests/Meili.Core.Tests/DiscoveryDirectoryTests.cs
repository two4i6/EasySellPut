using Meili.Core.Settings;

namespace Meili.Core.Tests;

public sealed class DiscoveryDirectoryTests
{
    [Fact]
    public void Discovery_reads_existing_legacy_profile_without_moving_it()
    {
        var root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        var legacy = Path.Combine(root, DataDirectoryResolver.LegacyAppFolderName);
        Directory.CreateDirectory(legacy);
        try
        {
            File.WriteAllText(Path.Combine(legacy, "settings.json"), "preserve");
            var result = DataDirectoryResolver.Resolve([], root, root, migrateLegacy: false);
            Assert.Equal(legacy, result.Path);
            Assert.True(Directory.Exists(legacy));
            Assert.False(Directory.Exists(Path.Combine(root, DataDirectoryResolver.AppFolderName)));
            var migrated = DataDirectoryResolver.Resolve([], root, root);
            Assert.Equal(Path.Combine(root, DataDirectoryResolver.AppFolderName), migrated.Path);
            Assert.Equal("preserve", File.ReadAllText(Path.Combine(migrated.Path, "settings.json")));
        }
        finally { Directory.Delete(root, true); }
    }
}
