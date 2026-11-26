using Meili.Automation.Modules;
using Meili.Core.Settings;

namespace Meili.Automation.Tests;

public sealed class ModuleRegistryTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "esp-registry-" + Guid.NewGuid().ToString("N"));
    private static InstalledModule App(string id = "easysellput.test") => new(id, "1.0.0", new string('A', 64), 1, true);
    [Fact]
    public void Discovery_is_read_only_and_stale_writers_cannot_overwrite_another_process_snapshot()
    {
        var first = new ModuleRegistry(root); var second = new ModuleRegistry(root);
        var a = first.Read(); var b = second.Read();
        Assert.False(Directory.Exists(root));
        var saved = first.Save(a.Revision, [App()]);
        Assert.Equal(1, saved.State.Generation);
        Assert.Throws<DataConflictException>(() => second.Save(b.Revision, [App("easysellput.other")]));
        Assert.Equal("easysellput.test", Assert.Single(second.Read().State.Apps).Id);
    }
    [Fact]
    public void Actual_execution_blocks_maintenance_but_idle_metadata_does_not()
    {
        var registry = new ModuleRegistry(root);
        using (registry.AcquireExecution("easysellput.test"))
        using (new ModuleRegistry(root).AcquireExecution("easysellput.test"))
            Assert.Throws<IOException>(() => registry.AcquireMaintenance("easysellput.test"));
        using (registry.AcquireMaintenance("easysellput.test"))
            Assert.Throws<IOException>(() => registry.AcquireExecution("easysellput.test"));
        using var next = registry.AcquireExecution("easysellput.test");
    }
    [Fact]
    public void Corrupt_metadata_and_unsafe_id_never_initialize_or_replace_registry()
    {
        var registry = new ModuleRegistry(root);
        Assert.Throws<InvalidDataException>(() => registry.AcquireExecution("../escape"));
        Assert.False(Directory.Exists(root));
        Directory.CreateDirectory(registry.Root);
        var path = Path.Combine(registry.Root, "registry.json"); File.WriteAllText(path, "null");
        Assert.Throws<InvalidDataException>(() => registry.Read());
        Assert.Equal("null", File.ReadAllText(path));
    }
    public void Dispose() { if (Directory.Exists(root)) Directory.Delete(root, true); }
}
