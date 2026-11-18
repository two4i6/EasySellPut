using Meili.Automation.Modules;
namespace Meili.Shared.Services;

/// <summary>Presentation hint only; signed content is independently reverified before use.</summary>
public static class ModuleNavigation
{
    public static IReadOnlyList<InstalledModule> Entries(string directory)
    {
        try{return new ModuleRegistry(directory).Read().State.Apps.Where(a=>a.Enabled&&a.HasUi==true&&a.Id!=ModuleAccess.QqqGex).ToArray();}
        catch(Exception ex)when(ex is IOException or System.Text.Json.JsonException or UnauthorizedAccessException)
        {Meili.Core.Diagnostics.AppLog.Warn("apps","Application navigation metadata unavailable",ex);return [];}
    }
    public static bool IsAvailable(string directory, AppPage page)
    {
        if(page is not (AppPage.QqqGex or AppPage.Options or AppPage.Strategy or AppPage.Charts))return true;
        try
        {
        if(page==AppPage.Charts)return ModuleAccess.IsEnabled(directory,ModuleAccess.Charts);
        if(page is AppPage.Options or AppPage.Strategy)return ModuleAccess.IsEnabled(directory,ModuleAccess.OptionsStrategy);
        var state=new ModuleRegistry(directory).Read().State;
        var app=state.Apps.SingleOrDefault(a=>a.Id==ModuleAccess.QqqGex);
        return app is null?!(state.SuppressedSeeds??[]).Contains(ModuleAccess.QqqGex):app.Enabled&&app.HasUi!=false;
        }
        catch(Exception ex) when(ex is IOException or System.Text.Json.JsonException or UnauthorizedAccessException)
        { Meili.Core.Diagnostics.AppLog.Warn("apps","Application navigation metadata unavailable",ex);return false; }
    }
}
