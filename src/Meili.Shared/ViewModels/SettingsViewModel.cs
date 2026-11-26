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
    private readonly WebWorkspace? _workspace;
    private bool _resettingMotion;
    private bool _syncingLanguage;
    [ObservableProperty] public partial bool ReduceMotionEnabled { get; set; }
    [ObservableProperty] [NotifyPropertyChangedFor(nameof(HasMotionStatus))] public partial string MotionStatus { get; set; } = "";
    public bool HasMotionStatus => !string.IsNullOrEmpty(MotionStatus);
    public bool CanChangeMotion => _workspace is not null;
    partial void OnReduceMotionEnabledChanged(bool value)
    {
        if (!_ready || _resettingMotion || _workspace is null) return;
        try { _workspace.SetReduceMotion(value); MotionStatus = ""; }
        catch (IOException ex)
        {
            Meili.Core.Diagnostics.AppLog.Warn("settings", "Motion preference could not be saved", ex);
            _resettingMotion = true; ReduceMotionEnabled = _workspace.ReduceMotion; _resettingMotion = false;
            MotionStatus = _loc["Web_Failed"];
        }
    }
    private readonly Meili.Caching.CacheManager? _cacheManager;
    private Meili.Caching.CacheReport? _cacheReport;
    [ObservableProperty] public partial IReadOnlyList<StorageSegmentView> StorageSegments { get; set; } = [];
    [ObservableProperty] public partial string StorageTotal { get; set; } = "—";
    [ObservableProperty] [NotifyPropertyChangedFor(nameof(HasStorageStatus))] public partial string StorageStatus { get; set; } = "";
    public bool HasStorageStatus => !string.IsNullOrEmpty(StorageStatus);
    private void FormatCacheSummary()
    {
        if (_cacheReport?.Storage is { } storage)
        {
            StorageSegments = storage.Categories.Select(c => new StorageSegmentView(c.Id, _loc["Storage_" + c.Id], StorageSegmentView.FormatBytes(c.Bytes), storage.TotalBytes == 0 ? 0 : c.Bytes / (double)storage.TotalBytes, c.Bytes)).ToArray();
            StorageTotal = StorageSegmentView.FormatBytes(storage.TotalBytes);
            StorageStatus = storage.Complete ? "" : _loc["Storage_Partial"];
        }
        if (_cacheReport is not null) CacheSummary = string.Join(" · ", _cacheReport.Caches.Select(c => _loc["Cache_" + c.Id] + " " + c.Entries.ToString("N0")));
    }
    private static readonly string[] CacheCategories = ["all", "responses", "bars", "quotes", "search", "rates", "qqq_gex_wire"];
    [ObservableProperty] public partial int CacheCategoryIndex { get; set; }
    [ObservableProperty] public partial string CacheSummary { get; set; } = "—";
    [ObservableProperty] public partial string CacheFeedback { get; set; } = "";
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanManageCache))]
    [NotifyCanExecuteChangedFor(nameof(RefreshCacheCommand), nameof(ClearCacheCommand), nameof(ClearExpiredCacheCommand), nameof(CompactGexCacheCommand))]
    public partial bool IsCacheBusy { get; set; }
    public bool CanManageCache => !IsCacheBusy && _cacheManager is not null;
    private async Task CacheActionAsync(bool? expiredOnly,bool compact=false)
    {
        if (!CanManageCache) return;
        IsCacheBusy = true; CacheFeedback = "";
        var category = compact?"qqq_gex_wire":CacheCategories[Math.Clamp(CacheCategoryIndex, 0, CacheCategories.Length - 1)];
        try
        {
            if (expiredOnly == false && !await Ui.Platform.ConfirmAsync(_loc["Cache_Clear"], _loc["Cache_" + category] + "\n\n" + _loc["Cache_Confirm"])) return;
            var result = await Task.Run(() =>
            {
                if(compact)_cacheManager!.Compact(category);else if (expiredOnly is { } expired) _cacheManager!.Clear(category, expired);
                return _cacheManager!.Inspect();
            });
            _cacheReport = result; FormatCacheSummary();
            if (expiredOnly is not null||compact) CacheFeedback = _loc[compact?"Cache_Compacted":"Cache_Done"];
        }
        catch (Exception ex)
        {
            Meili.Core.Diagnostics.AppLog.Warn("cache", "Cache management failed", ex);
            CacheFeedback = _loc["Cache_Error"];
        }
        finally { IsCacheBusy = false; }
    }
    [RelayCommand(CanExecute = nameof(CanManageCache))]
    private Task RefreshCacheAsync() => CacheActionAsync(null);
    [RelayCommand(CanExecute = nameof(CanManageCache))]
    private Task ClearCacheAsync() => CacheActionAsync(false);
    [RelayCommand(CanExecute = nameof(CanManageCache))]
    private Task ClearExpiredCacheAsync() => CacheActionAsync(true);
    [RelayCommand(CanExecute = nameof(CanManageCache))]
    private Task CompactGexCacheAsync() => CacheActionAsync(null,true);


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
    public AppManagementViewModel Applications { get; }
    public string DataDirectory { get; }
    public string Version { get; } = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.0.0";

    public SettingsViewModel(SettingsStore store, LocalizationService loc, IThemeController theme, DataDirectoryInfo dataDir, IServiceProvider sp, McpConnectionSetup? connection = null, IUpdateCoordinator? updater = null)
    {
        _store = store; _loc = loc; _theme = theme;
        var applications=sp.GetService(typeof(AppManagementViewModel)) as AppManagementViewModel;
        Applications=applications?.DataDirectory==dataDir.Path?applications:new(dataDir.Path,loc);
        _loc.LanguageChanged+=(_,_)=>
        {
            Applications.RefreshLanguage();_syncingLanguage=true;
            try{LanguageIndex=_loc.Language=="en-US"?1:0;}finally{_syncingLanguage=false;}
        };
        _cacheManager = sp.GetService(typeof(Meili.Caching.CacheManager)) as Meili.Caching.CacheManager;
        Updates = updater is not null ? new UpdateViewModel(store, loc, dataDir, updater)
            : sp.GetService(typeof(UpdateViewModel)) as UpdateViewModel ?? new UpdateViewModel(store, loc, dataDir);
        try
        {
            _workspace = sp.GetService(typeof(WebWorkspace)) as WebWorkspace ?? new WebWorkspace(dataDir.Path);
            ReduceMotionEnabled = _workspace.ReduceMotion;
        }
        catch (Exception ex) when (ex is IOException or System.Text.Json.JsonException or ArgumentException)
        { Meili.Core.Diagnostics.AppLog.Warn("settings", "Motion preferences unavailable", ex); MotionStatus = _loc["Web_Failed"]; }
        _connection = connection ?? McpConnectionSetup.Bundled(AppContext.BaseDirectory, dataDir.Path);
        _loc.LanguageChanged += (_, _) => { FormatCacheSummary(); CacheFeedback = ""; OnPropertyChanged(nameof(AiConnectionStatus)); OnPropertyChanged(nameof(CodexAvailability)); OnPropertyChanged(nameof(ClaudeAvailability)); OnPropertyChanged(nameof(AiTerminalLabel)); };
        _network = sp.GetService(typeof(INetworkController)) as INetworkController;
        var s = store.Current;
        LanguageIndex = _loc.Language == "en-US" ? 1 : 0;
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
    }

    partial void OnLanguageIndexChanged(int value)
    {
        if (!_ready || _syncingLanguage) return;
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

    /// <summary>One desktop update state shared with the footer and notification dialog.</summary>
    public UpdateViewModel Updates { get; }
}
