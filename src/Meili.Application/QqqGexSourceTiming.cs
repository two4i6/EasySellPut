using Meili.Core.Models;
namespace Meili.Automation;

/// <summary>Distinguishes publication time from the reported delayed underlying event. Never invents a quote timestamp.</summary>
internal static class QqqGexSourceTiming
{
    internal static DateTimeOffset? MarketAt(OptionChain chain)
    {
        if (chain.AsOf is not { } publication) return null;
        if (!string.Equals(chain.Source, "cboe", StringComparison.OrdinalIgnoreCase))
            return chain.UnderlyingLastTradeAt is { } trade && trade.UtcDateTime.Date != publication.UtcDateTime.Date ? null : publication;
        // CBOE root.timestamp is publication, not market time. Its liquid QQQ underlying trade
        // supplies the actual event anchor; declared delay only validates it, never manufactures it.
        if (chain.UnderlyingLastTradeAt is not { } eventAt || chain.DelayMinutes is not >= 0) return null;
        var lag = publication - eventAt;
        var delay = TimeSpan.FromMinutes(chain.DelayMinutes.Value);
        return lag >= TimeSpan.Zero && (lag-delay).Duration() <= TimeSpan.FromMinutes(2)
            && Meili.Core.Time.MarketClock.ToEastern(publication).Date == Meili.Core.Time.MarketClock.ToEastern(eventAt).Date ? eventAt : null;
    }
}
