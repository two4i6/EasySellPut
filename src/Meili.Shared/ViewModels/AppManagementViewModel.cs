using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Meili.Automation.Modules;
using Meili.Shared.Services;

namespace Meili.Shared.ViewModels;

public sealed record ManagedAppRow(string Id, string Version, bool Enabled)
{
    public override string ToString() => Id + " · " + Version;
}

/// <summary>Shared explicit local app maintenance; native views provide only selection and presentation.</summary>
public partial class AppManagementViewModel(string directory, LocalizationService loc) : ObservableObject
{
    public string DataDirectory => directory;
    [ObservableProperty] public partial IReadOnlyList<ManagedAppRow> Apps { get; set; } = [];
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(ToggleAppCommand), nameof(UninstallAppCommand))]
    [NotifyPropertyChangedFor(nameof(ToggleLabel), nameof(SelectedStatus))]
    public partial ManagedAppRow? SelectedApp { get; set; }
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(RefreshAppsCommand), nameof(InstallAppCommand), nameof(ToggleAppCommand), nameof(UninstallAppCommand))]
    public partial bool IsBusy { get; set; }
    [ObservableProperty] public partial string Status { get; set; } = "";
    public string SelectedStatus => SelectedApp is null ? "" : loc[SelectedApp.Enabled ? "Apps_Enabled" : "Apps_Disabled"];
    public string ToggleLabel => loc[SelectedApp?.Enabled == true ? "Apps_Disable" : "Apps_Enable"];
    private bool CanMaintain() => !IsBusy;
    private bool HasSelection() => !IsBusy && SelectedApp is not null;
    public event EventHandler? Changed;
    private string? statusKey;
    private void ShowStatus(string? key) { statusKey=key;Status=key is null?"":loc[key]; }
    public void RefreshLanguage()
    {
        OnPropertyChanged(nameof(ToggleLabel));OnPropertyChanged(nameof(SelectedStatus));
        if(statusKey is not null)Status=loc[statusKey];
    }
    private async Task Maintain(Func<ModuleInstaller, Task> action)
    {
        if(IsBusy)return;
        IsBusy=true;ShowStatus(null);
        try
        {
            await action(new ModuleInstaller(directory));
            var rows = await Task.Run(()=>new ModuleInstaller(directory).Inspect().State.Apps.Select(a=>new ManagedAppRow(a.Id,a.Version,a.Enabled)).ToArray());
            var id=SelectedApp?.Id;Apps=rows;SelectedApp=Apps.FirstOrDefault(a=>a.Id==id)??Apps.FirstOrDefault();
            ShowStatus(Apps.Count==0?"Apps_Empty":"Apps_Done");Changed?.Invoke(this,EventArgs.Empty);
        }
        catch(Exception ex) when(ex is IOException or InvalidDataException or UnauthorizedAccessException or ArgumentException or InvalidOperationException or System.Security.Cryptography.CryptographicException or System.Text.Json.JsonException)
        {
            Meili.Core.Diagnostics.AppLog.Warn("apps","Application maintenance failed",ex);
            ShowStatus("Apps_Error");
        }
        finally{IsBusy=false;}
    }
    [RelayCommand(CanExecute=nameof(CanMaintain))]
    private Task RefreshAppsAsync()=>Maintain(_=>Task.CompletedTask);
    [RelayCommand(CanExecute=nameof(CanMaintain))]
    private async Task InstallAppAsync()
    {
        var path=await Ui.Platform.PickOpenPathAsync(loc["Apps_Install"],"espapp");
        if(path is null)return;
        await Maintain(installer=>Task.Run(()=>installer.InstallAsync(path)));
    }
    [RelayCommand(CanExecute=nameof(HasSelection))]
    private Task ToggleAppAsync()
    {
        var selected=SelectedApp!;
        return Maintain(installer=>installer.SetEnabledAsync(selected.Id,!selected.Enabled));
    }
    [RelayCommand(CanExecute=nameof(HasSelection))]
    private async Task UninstallAppAsync()
    {
        var selected=SelectedApp!;
        if(!await Ui.Platform.ConfirmAsync(loc["Apps_Uninstall"],selected.Id+"\n\n"+loc["Apps_PreserveData"]))return;
        await Maintain(installer=>Task.Run(()=>installer.Uninstall(selected.Id)));
    }
}
