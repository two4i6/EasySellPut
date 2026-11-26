namespace Meili.Automation.Modules;

/// <summary>Explicit module removal/disable must never reactivate an old compatibility seed.</summary>
public static class ModuleAccess
{
    public const string Charts = "easysellput.charts";
    public static bool IsDelegatedWrite(string name) => OptionsStrategyContracts.IsWrite(name) || ChartContracts.IsWrite(name);
    public const string OptionsStrategy = "easysellput.options-strategy";
    public const string QqqGex = "easysellput.qqq-gex";
    public const string MarketLiquidity = "easysellput.market-liquidity";
    public const string NewsFundamentals = "easysellput.news-fundamentals";
    // Explicit first-party ownership; a package must never claim an unrelated built-in tool.
    public static string? OperationOwner(string name) => ChartContracts.Names.Contains(name,StringComparer.Ordinal) ? Charts : OptionsStrategyContracts.Names.Contains(name,StringComparer.Ordinal) ? OptionsStrategy : name is "get_news" or "get_fundamentals" or "get_financials" ? NewsFundamentals : name == "get_market_liquidity" ? MarketLiquidity :
        Apps.QqqGex.GexContracts.All.Any(operation => operation.Name == name) ? QqqGex : null;
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
