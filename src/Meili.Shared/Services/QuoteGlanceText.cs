using Meili.Core.Time;
using Meili.Shared.ViewModels;
namespace Meili.Shared.Services;

public static class QuoteGlanceText
{
    public static string GraphLabel(PanelQuoteRow row, LocalizationService loc, DateTimeOffset now)
    {
        var graph = row.Graph;
        if (graph.Day is not { } day) return EmptyLabel(row, loc);
        var session = loc[graph.Session == MarketSession.PreMarket ? "Quote_Pre" : graph.Session == MarketSession.AfterHours ? "Quote_Post" : graph.Session == MarketSession.Overnight ? "Quote_Overnight" : "QP_RegularShort"];
        return day.ToString("yyyy-MM-dd") + " · " + session
            + (graph.WindowStart is not null ? " · " + SourceNames.Display(graph.Source,loc) + " · " + loc["QP_ObservedWindow"] : row.ChartMeta is { } meta ? " · " + FreshnessText.SourceAndTiming(meta with { AsOf = graph.AsOf }, loc, now) : "")
            + (graph.WindowStart is null && row.ChartObserved && row.Display?.Session == graph.Session ? " · " + loc["QP_ObservedTail"] : "")
            + (row.ChartRepairing && row.Display?.Session == graph.Session ? " · " + loc["Ch_Backfilling"] : "")
            + (graph.Offline || row.GraphFailed ? " · " + loc["Mb_Stale"] : "");
    }
    public static readonly string[] SessionKeys = ["QP_ChartAuto", "Quote_Pre", "QP_RegularShort", "Quote_Post", "Quote_Overnight"];
    public static string EmptyLabel(PanelQuoteRow row, LocalizationService loc) => row.GraphFailed ? loc["QP_Retry"]
        : row.ChartRepairing && row.Display?.Session == row.Graph.Session ? loc["Ch_Backfilling"] : EmptyLabel(row.Graph.Session, loc);
    public static string EmptyLabel(MarketSession session, LocalizationService loc) => loc[session == MarketSession.Overnight ? "QP_NoNightChart" : "QP_NoChart"];
    public static string MiniLabel(PanelQuoteRow row, LocalizationService loc) => (row.Graph.Day?.ToString("MM-dd") ?? "—") + " · " + loc[row.Graph.Session == MarketSession.PreMarket ? "QP_PreShort" : row.Graph.Session == MarketSession.AfterHours ? "QP_PostShort" : row.Graph.Session == MarketSession.Overnight ? "Quote_Overnight" : "QP_RegularShort"];
}
