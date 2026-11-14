using Meili.Automation;
using Meili.Core.Settings;
using Meili.Shared.ViewModels;

namespace Meili.Shared.Tests;

[Collection(nameof(UiPlatformCollection))]
public sealed class AiConnectionTests : IDisposable
{
    private readonly string _path=Path.Combine(Path.GetTempPath(),"meili ai setup "+Guid.NewGuid().ToString("N"));
    private sealed class Theme:IThemeController {public void Apply(AppThemeMode mode){} public void ApplyUpDownColors(UpDownColorMode mode){}}
    private sealed class Services:IServiceProvider {public object? GetService(Type type)=>null;}
    [Fact]
    public async Task Copy_command_uses_bundled_executable_and_current_data_without_enabling_writes()
    {
        Directory.CreateDirectory(_path);var executable=Path.Combine(_path,"easysellput");File.WriteAllText(executable,"");
        var setup=new McpConnectionSetup(executable,Path.Combine(_path,"data"),false);var ui=new FakeUiPlatform();Ui.Platform=ui;
        var loc=new LocalizationService();var vm=new SettingsViewModel(new(_path),loc,new Theme(),new(_path,DataDirectorySource.CommandLine),new Services(),setup);
        Assert.True(vm.CanConnectAi);await vm.CopyCodexCommand.ExecuteAsync(null);Assert.Equal(setup.CodexCommand,ui.ClipboardText);Assert.DoesNotContain("--allow-writes",ui.ClipboardText);
        Assert.Equal(loc["Set_AiCopied"],vm.AiConnectionStatus);
        await vm.CopyMcpJsonCommand.ExecuteAsync(null);Assert.Equal(setup.Json,ui.ClipboardText);
        await vm.CopyMcpTomlCommand.ExecuteAsync(null);Assert.Equal(setup.Toml,ui.ClipboardText);
        loc.Apply("en-US");Assert.Equal(loc["Set_AiCopied"],vm.AiConnectionStatus);
    }
    [Fact]
    public async Task Clipboard_failure_is_shown_without_claiming_success()
    {
        Directory.CreateDirectory(_path);var executable=Path.Combine(_path,"easysellput");File.WriteAllText(executable,"");
        Ui.Platform=new FakeUiPlatform{FailCopy=true};var loc=new LocalizationService();
        var vm=new SettingsViewModel(new(_path),loc,new Theme(),new(_path,DataDirectorySource.CommandLine),new Services(),new(executable,_path,false));
        await vm.CopyCodexCommand.ExecuteAsync(null);Assert.Equal(loc["Set_AiCopyFailed"],vm.AiConnectionStatus);Assert.Null(((FakeUiPlatform)Ui.Platform).ClipboardText);
    }
    [Fact]
    public async Task Missing_cli_is_explicit_and_does_not_copy_a_broken_command()
    {
        Ui.Platform=new FakeUiPlatform();var loc=new LocalizationService();
        var vm=new SettingsViewModel(new(_path),loc,new Theme(),new(_path,DataDirectorySource.CommandLine),new Services(),new(Path.Combine(_path,"absent"),_path,false));
        Assert.False(vm.CanConnectAi);Assert.Equal(loc["Set_AiMissing"],vm.AiConnectionStatus);
        await vm.CopyCodexCommand.ExecuteAsync(null);Assert.Null(((FakeUiPlatform)Ui.Platform).ClipboardText);
    }
    public void Dispose(){if(Directory.Exists(_path))Directory.Delete(_path,true);}
}
