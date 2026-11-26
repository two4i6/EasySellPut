namespace Meili.Automation.Modules;
/// <summary>Stable domain ownership; no new trading or maintenance permission.</summary>
public static class OptionsStrategyContracts
{
    public static IReadOnlyList<string> Names {get;}=Array.AsReadOnly(new[]{"get_expirations","get_option_chain","analyze_strategy","get_saved_strategies","save_strategy","delete_strategy","analyze_option_chain","get_pricing_assumptions","get_volatility_insights","record_option_snapshot","build_strategy","strategy_what_if"});
    public static bool IsWrite(string name)=>name is "save_strategy" or "delete_strategy" or "record_option_snapshot";
}
