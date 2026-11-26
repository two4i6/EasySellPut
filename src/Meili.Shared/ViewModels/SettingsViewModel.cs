using Meili.Automation;
using System.Diagnostics;
using System.Reflection;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Meili.Shared.Services;
using Meili.Core.Settings;

namespace Meili.Shared.ViewModels;

public partial class SettingsViewModel : ObservableObject
{
    private static readonly ProxyMode[] ProxyModes = [ProxyMode.AutoDetect, ProxyMode.System, ProxyMode.Manual, ProxyMode.Direct];
    private readonly SettingsStore _store;
    private readonly LocalizationService _loc;
    private readonly IThemeController _theme;
    private readonly INetworkController? _network;
    private readonly bool _ready;

    [ObservableProperty] public partial int LanguageIndex { get; set; }
    [ObservableProperty] public partial int ThemeIndex { get; set; }
    [ObservableProperty] public partial int TextSizeIndex { get; set; }
    public IReadOnlyList<string> TextSizeOptions { get; } = AppSettings.TextSizeChoices.Select(percent => $"{percent}%").ToArray();
    [ObservableProperty] public partial int UpDownIndex { get; set; }
    [ObservableProperty] [NotifyPropertyChangedFor(nameof(IsManualProxy))] public partial int ProxyModeIndex { get; set; }
    [ObservableProperty] public partial string ManualProxy { get; set; } = "";
    [ObservableProperty] public partial string EffectiveProxy { get; set; } = "";
    [ObservableProperty] [NotifyPropertyChangedFor(nameof(IsFixedRate))] public partial int RateModeIndex { get; set; }
    [ObservableProperty] public partial string FixedRateText { get; set; } = "";
    /// <summary>D4: 0 ask, 1 minimize to tray, 2 exit.</summary>
    [ObservableProperty] public partial int CloseActionIndex { get; set; }
    [ObservableProperty] public partial string FixedRateError { get; set; } = "";

    private readonly McpConnectionSetup _connection;
    public bool IsTransientConnection => !_connection.Windows && _connection.Executable.Contains("/AppTranslocation/", StringComparison.Ordinal);
    public bool CanConnectAi => !IsTransientConnection && File.Exists(_connection.Executable);
    public string McpJson => CanConnectAi ? _connection.Json : "";
    public string McpToml => CanConnectAi ? _connection.Toml : "";
    public string CodexSetupCommand => CanConnectAi ? _connection.CodexSetupCommand : "";
    public string ClaudeSetupCommand => CanConnectAi ? _connection.ClaudeSetupCommand : "";
    public string CodexAvailability => _loc[AiClientLocator.Find("codex") is null ? "Set_AiCheckTerminal" : "Set_AiDetected"];
    public string ClaudeAvailability => _loc[AiClientLocator.Find("claude-code") is null ? "Set_AiCheckTerminal" : "Set_AiDetected"];
    public string AiTerminalLabel => _loc[_connection.Windows ? "Set_AiStepPowerShell" : "Set_AiStepTerminal"];
    public string AiConnectionStatus => _copyState switch
    {
        1=>_loc["Set_AiCopied"],2=>_loc["Set_AiCopyFailed"],3=>_loc["Set_AiTemplateCopied"],4=>_loc["Set_AiPromptCopied"],5=>_loc["Status_McpCopied"],
        _=>IsTransientConnection?_loc["Set_AiMoveApp"]:CanConnectAi?_loc["Set_AiReadonly"]:_loc["Set_AiMissing"]
    };
    private int _copyState;
    private async Task CopyConnectionAsync(string content,int state=1)
    {
        if(!CanConnectAi)return;
        try{await Ui.Platform.CopyTextAsync(content);_copyState=state;}
        catch(Exception ex){Meili.Core.Diagnostics.AppLog.Warn("ai-setup","Clipboard unavailable",ex);_copyState=2;}
        OnPropertyChanged(nameof(AiConnectionStatus));
    }
    [RelayCommand]
    private Task CopyUniversalSetupAsync()=>CopyConnectionAsync(_connection.ConfigurationPrompt(_loc.Language=="zh-CN"),5);
    [RelayCommand]
    private Task CopyCodexAsync()=>CopyConnectionAsync(_connection.CodexSetupCommand);
    [RelayCommand]
    private Task CopyClaudeAsync()=>CopyConnectionAsync(_connection.ClaudeSetupCommand);
    [RelayCommand]
    private Task CopyMcpTomlAsync()=>CopyConnectionAsync(_connection.Toml,3);
    [RelayCommand]
    private Task CopyMcpJsonAsync()=>CopyConnectionAsync(_connection.Json,3);
    [RelayCommand]
    private Task CopyAiPromptAsync(string client)
    {
        _=AiSkillInstaller.ClientFolder(client);
        var invocation=client=="codex"?"$easysellput-local":"/easysellput-local";
        return CopyConnectionAsync(invocation+(_loc.Language=="zh-CN"?" 比较 NVDA 和 AMD 的最新行情与近期事件，列出来源和行情时间。":" Compare NVDA and AMD quotes and recent events. Include source, as-of time and material data limitations."),4);
    }

    [RelayCommand]
    private void OpenAiHelp(string client)
    {
        _=AiSkillInstaller.ClientFolder(client);
        Ui.Platform.OpenUrl(client=="codex"?"https://developers.openai.com/codex/cli/":"https://code.claude.com/docs/en/setup");
    }

    public bool IsFixedRate => RateModeIndex == 1;

    public bool IsManualProxy => ProxyModeIndex == 2;
    public string DataDirectory { get; }
    public string Version { get; } = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.0.0";

    public SettingsViewModel(SettingsStore store, LocalizationService loc, IThemeController theme, DataDirectoryInfo dataDir, IServiceProvider sp, McpConnectionSetup? connection = null, IUpdateCoordinator? updater = null)
    {
        _store = store; _loc = loc; _theme = theme;
        _updater = updater ?? new UpdateCoordinator(store,dataDir.Path,AppContext.BaseDirectory);
        _connection = connection ?? McpConnectionSetup.Bundled(AppContext.BaseDirectory, dataDir.Path);
        _loc.LanguageChanged += (_, _) => { RefreshUpdateBindings(); OnPropertyChanged(nameof(AiConnectionStatus)); OnPropertyChanged(nameof(CodexAvailability)); OnPropertyChanged(nameof(ClaudeAvailability)); OnPropertyChanged(nameof(AiTerminalLabel)); };
        _network = sp.GetService(typeof(INetworkController)) as INetworkController;
        var s = store.Current;
        LanguageIndex = s.Language == "en-US" ? 1 : 0;
        ThemeIndex = (int)s.Theme;
        TextSizeIndex = AppSettings.TextSizeChoices.ToList().IndexOf(AppSettings.NormalizeTextSize(s.TextSizePercent));
        UpDownIndex = (int)s.EffectiveUpDownColors();
        ProxyModeIndex = Math.Max(0, Array.IndexOf(ProxyModes, s.Network.ProxyMode));
        ManualProxy = s.Network.ManualProxy;
        DataDirectory = dataDir.Path;
        EffectiveProxy = _network?.EffectiveDescription ?? "—";
        CloseActionIndex = (int)s.CloseAction;
        RateModeIndex = s.Pricing.RateMode == RiskFreeRateMode.Fixed ? 1 : 0;
        FixedRateText = s.Pricing.FixedRatePercent.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture);
        _ready = true;
        ReadUpdateResult();
    }

    partial void OnLanguageIndexChanged(int value)
    {
        if (!_ready) return;
        var lang = value == 1 ? "en-US" : "zh-CN";
        _loc.Apply(lang);
        _store.Update(s => s.Language = lang);
    }

    partial void OnThemeIndexChanged(int value)
    {
        if (!_ready) return;
        var mode = (AppThemeMode)Math.Clamp(value, 0, 2);
        _theme.Apply(mode);
        _store.Update(s => s.Theme = mode);
    }

    partial void OnTextSizeIndexChanged(int value)
    {
        if (!_ready || value < 0 || value >= AppSettings.TextSizeChoices.Count) return;
        var percent = AppSettings.TextSizeChoices[value];
        if (percent == _store.Current.TextSizePercent) return;
        _store.Update(s => s.TextSizePercent = percent);
        DesignTypography.Apply(percent);
    }

    partial void OnUpDownIndexChanged(int value)
    {
        if (!_ready) return;
        var mode = (UpDownColorMode)Math.Clamp(value, 0, 1);
        _theme.ApplyUpDownColors(mode);
        _store.Update(s => { s.UpDownColors = mode; s.UpDownColorsChosen = true; });
    }

    partial void OnProxyModeIndexChanged(int value)
    {
        if (!_ready) return;
        _store.Update(s => s.Network.ProxyMode = ProxyModes[Math.Clamp(value, 0, ProxyModes.Length - 1)]);
        if (!IsManualProxy) _ = ApplyProxyAsync();
    }

    partial void OnManualProxyChanged(string value)
    {
        if (!_ready) return;
        _store.Update(s => s.Network.ManualProxy = value.Trim());
    }

    partial void OnCloseActionIndexChanged(int value)
    {
        if (!_ready) return;
        _store.Update(s => s.CloseAction = (CloseAction)Math.Clamp(value, 0, 2));
    }

    partial void OnRateModeIndexChanged(int value)
    {
        if (!_ready) return;
        _store.Update(s => s.Pricing.RateMode = value == 1 ? RiskFreeRateMode.Fixed : RiskFreeRateMode.Treasury13Week);
    }

    partial void OnFixedRateTextChanged(string value)
    {
        if (!_ready) return;
        if (double.TryParse(value.Trim().TrimEnd('%'), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var pct)
            && pct is >= -1 and <= 20)
        {
            FixedRateError = "";
            _store.Update(s => s.Pricing.FixedRatePercent = pct);
        }
        else FixedRateError = _loc["Set_RateInvalid"];
    }

    [RelayCommand]
    private async Task ApplyProxyAsync()
    {
        if (_network is null) return;
        EffectiveProxy = "…";
        EffectiveProxy = await _network.ReconfigureAsync();
    }

    [RelayCommand]
    private void OpenDataFolder() => Ui.Platform.OpenFolder(DataDirectory);

    private readonly IUpdateCoordinator _updater;
    private UpdateRelease? _updateRelease;
    private string? _updateArchive;
    private string _updateState="Upd_Idle";
    private CancellationTokenSource? _updateStop;
    [ObservableProperty] public partial bool IsUpdating {get;set;}
    [ObservableProperty] public partial double UpdateProgress {get;set;}
    public string UpdateVersionLine=>"v"+Version+(_updateRelease is null?"":"  →  v"+_updateRelease.Manifest.Version);
    public string UpdateStatusText=>_loc[_updateState];
    public string UpdateNotes=>_updateRelease?.Notes??"";
    public bool HasUpdateNotes=>!string.IsNullOrWhiteSpace(UpdateNotes);
    public bool ShowDownloadUpdate=>_updateRelease is not null&&_updateArchive is null;
    public bool ShowInstallUpdate=>_updateArchive is not null;
    public bool ShowUpdateProgress=>IsUpdating;
    public bool ShowUpdateFolder=>_updateArchive is not null&&(!_updater.CanInstall||_updateState=="Upd_Failed");
    public bool IsUpdateIndeterminate=>_updateState!="Upd_Downloading";
    public bool CanCheckUpdates=>!IsUpdating;
    public bool CanDownloadUpdate=>!IsUpdating&&ShowDownloadUpdate;
    public bool CanInstallUpdate=>!IsUpdating&&ShowInstallUpdate&&_updater.CanInstall;
    partial void OnIsUpdatingChanged(bool value)=>RefreshUpdateBindings();
    private void RefreshUpdateBindings()
    {
        foreach(var property in new[]{nameof(UpdateVersionLine),nameof(UpdateStatusText),nameof(UpdateNotes),nameof(HasUpdateNotes),nameof(ShowDownloadUpdate),nameof(ShowInstallUpdate),nameof(ShowUpdateProgress),nameof(ShowUpdateFolder),nameof(IsUpdateIndeterminate),nameof(CanCheckUpdates),nameof(CanDownloadUpdate),nameof(CanInstallUpdate)})OnPropertyChanged(property);
        CheckUpdatesCommand.NotifyCanExecuteChanged();DownloadUpdateCommand.NotifyCanExecuteChanged();InstallUpdateCommand.NotifyCanExecuteChanged();
    }
    [RelayCommand(CanExecute=nameof(CanCheckUpdates))]
    private Task CheckUpdatesAsync()=>RunUpdateAsync("Upd_Checking",async ct=>
    {
        _updateArchive=null;_updateRelease=null;
        var result=await _updater.CheckAsync(ct);_updateRelease=result.Release;
        _updateState=result.Status switch{"available"=>"Upd_Available","current"=>"Upd_Current","no_release"=>"Upd_NoRelease",_=>"Upd_Failed"};
    });
    [RelayCommand(CanExecute=nameof(CanDownloadUpdate))]
    private Task DownloadUpdateAsync()=>RunUpdateAsync("Upd_Downloading",async ct=>
    {
        UpdateProgress=0;
        _updateArchive=await _updater.DownloadAsync(_updateRelease!,new Progress<double>(value=>UpdateProgress=value),ct);
        _updateState=_updater.CanInstall?"Upd_Ready":"Upd_Manual";
    });
    [RelayCommand(CanExecute=nameof(CanInstallUpdate))]
    private async Task InstallUpdateAsync()
    {
        if(!CanInstallUpdate)return;
        if(!await Ui.Platform.ConfirmAsync(_loc["Upd_ConfirmTitle"],string.Format(_loc["Upd_Confirm"],_updateRelease!.Manifest.Version)))return;
        await RunUpdateAsync("Upd_Preparing",async ct=>
        {
            await _updater.PrepareInstallAsync(_updateRelease!,_updateArchive!,ct);
            _updateState="Upd_Restarting";RefreshUpdateBindings();Ui.Platform.ExitForUpdate();
        });
    }
    [RelayCommand]
    private void CancelUpdate()=>_updateStop?.Cancel();
    [RelayCommand]
    private void OpenUpdateFolder(){if(_updateArchive is not null)Ui.Platform.OpenFolder(Path.GetDirectoryName(_updateArchive)!);}
    [RelayCommand]
    private void OpenUpdateHistory()=>Ui.Platform.OpenUrl("https://github.com/"+UpdateClient.Repository+"/releases");
    private async Task RunUpdateAsync(string state,Func<CancellationToken,Task> work)
    {
        if(IsUpdating)return;
        using var stop=new CancellationTokenSource();_updateStop=stop;_updateState=state;IsUpdating=true;
        try{await work(stop.Token);}
        catch(OperationCanceledException){_updateState=stop.IsCancellationRequested?"Upd_Cancelled":"Upd_Timeout";}
        catch(Exception ex)
        {
            Meili.Core.Diagnostics.AppLog.Warn("updater","Update action failed",ex);
            _updateState=ex is System.Security.Cryptography.CryptographicException or InvalidDataException?"Upd_Unverified":ex is InvalidOperationException && ex.Message=="update_mcp_active"?"Upd_McpActive":"Upd_Failed";
        }
        finally{_updateStop=null;IsUpdating=false;RefreshUpdateBindings();}
    }
    private void ReadUpdateResult()
    {
        try
        {
            var file=new FileInfo(UpdateInstaller.ResultFile(DataDirectory));if(!file.Exists||file.Length>8192||file.LinkTarget is not null)return;
            var result=System.Text.Json.JsonSerializer.Deserialize<UpdateInstallResult>(File.ReadAllText(file.FullName),UpdateInstaller.Json);
            if(result?.Status=="installed"&&result.Version==Version)_updateState="Upd_Installed";
            else if(result?.Status is "failed" or "restart_required")_updateState="Upd_PreviousFailed";
        }
        catch(Exception ex){Meili.Core.Diagnostics.AppLog.Warn("updater","Previous update status unavailable",ex);}
    }
}
