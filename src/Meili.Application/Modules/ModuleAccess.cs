namespace Meili.Automation.Modules;

/// <summary>Explicit module removal/disable must never reactivate an old compatibility seed.</summary>
public static class ModuleAccess
{
    public const string QqqGex = "easysellput.qqq-gex";
    public static bool IsEnabled(string directory, string id)
    {
        var state = new ModuleRegistry(directory).Read().State;
        var installed = state.Apps.SingleOrDefault(a => a.Id == id);
        return installed?.Enabled ?? !(state.SuppressedSeeds ?? []).Contains(id, StringComparer.Ordinal);
    }
    public static IDisposable AcquireEnabled(string directory, string id)
    {
        var registry = new ModuleRegistry(directory);
        if (!IsEnabled(directory, id)) throw new InvalidOperationException("Application is disabled or uninstalled. Reinstall or enable it explicitly.");
        var lease = registry.AcquireExecution(id);
        try { if (!IsEnabled(directory, id)) throw new InvalidOperationException("Application changed before execution."); return lease; }
        catch { lease.Dispose(); throw; }
    }
}
