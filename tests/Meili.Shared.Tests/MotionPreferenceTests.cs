using Meili.Core.Settings;
using Meili.Shared.ViewModels;
namespace Meili.Shared.Tests;
public sealed class MotionPreferenceTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "motion-setting-" + Guid.NewGuid().ToString("N"));
    private sealed class Services(WebWorkspace workspace) : IServiceProvider { public object? GetService(Type type) => type == typeof(WebWorkspace) ? workspace : null; }
    private sealed class Theme : IThemeController { public void Apply(AppThemeMode mode) { } public void ApplyUpDownColors(UpDownColorMode mode) { } }
    private SettingsViewModel Create(WebWorkspace workspace) => new(new(_dir), new(), new Theme(), new(_dir, DataDirectorySource.CommandLine), new Services(workspace));
    public void Dispose() { if (Directory.Exists(_dir)) Directory.Delete(_dir, true); }
    [Fact] public void Settings_and_bookmarks_share_one_revision_and_motion_is_persisted()
    {
        var workspace = new WebWorkspace(_dir); var a = workspace.Save(null, "News", "https://example.com"); var vm = Create(workspace);
        vm.ReduceMotionEnabled = true; Assert.True(workspace.ReduceMotion); Assert.False(vm.HasMotionStatus);
        workspace.Save(a.Id, "Research", "https://example.org"); var reloaded = new WebWorkspace(_dir);
        Assert.True(reloaded.ReduceMotion); Assert.Equal("Research", Assert.Single(reloaded.Tabs).Name);
    }
    [Fact] public void Conflicting_save_reverts_toggle_and_keeps_external_bookmarks()
    {
        var workspace = new WebWorkspace(_dir); var vm = Create(workspace); var other = new WebWorkspace(_dir);
        other.Save(null, "External", "https://example.com"); vm.ReduceMotionEnabled = true;
        Assert.False(vm.ReduceMotionEnabled); Assert.True(vm.HasMotionStatus); Assert.False(workspace.ReduceMotion);
        Assert.Equal("External", Assert.Single(new WebWorkspace(_dir).Tabs).Name);
    }
}
