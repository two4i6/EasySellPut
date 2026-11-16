using Meili.Core.Time;
using Meili.Shared.ViewModels;
namespace Meili.Shared.Services;

public static class QuoteGlanceText
{
    public static string GraphLabel(PanelQuoteRow row, LocalizationService loc, DateTimeOffset now)
    {
        var graph = row.Graph;
        if (graph.Day is not { } day) return loc["QP_NoChart"];
        var session = loc[graph.Session == MarketSession.PreMarket ? "Quote_Pre" : graph.Session == MarketSession.AfterHours ? "Quote_Post" : "QP_RegularShort"];
        return day.ToString("yyyy-MM-dd") + " · " + session
            + (row.ChartMeta is { } meta ? " · " + FreshnessText.SourceAndTiming(meta with { AsOf = graph.AsOf }, loc, now) : "")
            + (graph.Offline || row.GraphFailed ? " · " + loc["Mb_Stale"] : "");
    }
    public static string MiniLabel(PanelQuoteRow row, LocalizationService loc) => (row.Graph.Day?.ToString("MM-dd") ?? "—") + " · " + loc[row.Display?.ShortKey ?? "QP_RegularShort"];
}
