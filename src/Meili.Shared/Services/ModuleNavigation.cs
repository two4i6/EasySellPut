using Meili.Automation.Modules;
namespace Meili.Shared.Services;

/// <summary>Presentation hint only; signed content is independently reverified before use.</summary>
public static class ModuleNavigation
{
    public static bool IsAvailable(string directory, AppPage page)
    {
        if(page != AppPage.QqqGex)return true;
        try
        {
        var state=new ModuleRegistry(directory).Read().State;
        var app=state.Apps.SingleOrDefault(a=>a.Id==ModuleAccess.QqqGex);
        return app is null?!(state.SuppressedSeeds??[]).Contains(ModuleAccess.QqqGex):app.Enabled&&app.HasUi!=false;
        }
        catch(Exception ex) when(ex is IOException or System.Text.Json.JsonException or UnauthorizedAccessException)
        { Meili.Core.Diagnostics.AppLog.Warn("apps","Application navigation metadata unavailable",ex);return false; }
    }
}
