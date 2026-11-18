namespace Meili.Automation.Modules;
/// <summary>Chart domain contracts; live transport and generic calculations remain shared host capabilities.</summary>
public static class ChartContracts
{
    public static IReadOnlyList<string> Names {get;}=Array.AsReadOnly(new[]{"get_bars","get_chart_analysis","get_market_events","get_chart_drawings","add_chart_drawing","update_chart_drawing","delete_chart_drawing","clear_chart_drawings"});
    public static bool IsWrite(string name)=>name is "add_chart_drawing" or "update_chart_drawing" or "delete_chart_drawing" or "clear_chart_drawings";
}
