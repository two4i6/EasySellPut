using Meili.Core.Models;
using Meili.Core.Time;
namespace Meili.Shared.Services;

/// <summary>Glance-only projection. Never changes the original regular quote used by analytics and alerts.</summary>
public sealed record QuotePriceView(Quote Snapshot, bool IsExtended, MarketSession Session)
{
    public string SessionKey => !IsExtended ? "Mb_Regular" : Session == MarketSession.PreMarket ? "Quote_Pre" : Session == MarketSession.AfterHours ? "Quote_Post" : "QP_Extended";
    public string ShortKey => !IsExtended ? "QP_RegularShort" : Session == MarketSession.PreMarket ? "QP_PreShort" : Session == MarketSession.AfterHours ? "QP_PostShort" : "QP_ExtendedShort";
    public static QuotePriceView Select(Quote quote, DateTimeOffset now)
    {
        if (quote.MarketState == MarketState.Regular || quote.ExtendedPrice is not > 0 || !double.IsFinite(quote.ExtendedPrice.Value)
            || quote.ExtendedTime is not { } at || at > now || quote.AsOf is { } regular && at <= regular)
            return new(quote, false, MarketSession.Regular);
        static double? Finite(double? n) => n is { } v && double.IsFinite(v) ? v : null;
        var price = quote.ExtendedPrice.Value;
        var change = Finite(quote.ExtendedChange) ?? (quote.Price > 0 && double.IsFinite(quote.Price) ? Finite(price - quote.Price) : null);
        var percent = Finite(quote.ExtendedChangePercent) ?? (quote.Price > 0 && double.IsFinite(quote.Price) && change is { } c ? Finite(c / quote.Price * 100) : null);
        var time = MarketClock.ToEastern(at).TimeOfDay;
        var session = time >= TimeSpan.FromHours(4) && time < TimeSpan.FromHours(9.5) ? MarketSession.PreMarket
            : time >= TimeSpan.FromHours(16) ? MarketSession.AfterHours : MarketSession.Closed;
        return new(quote with { Price = price, Change = change, ChangePercent = percent, Delivery=quote.ExtendedDelivery??quote.Delivery,Source=quote.ExtendedSource??quote.Source,IsRealtime=quote.ExtendedDelivery=="websocket"?false:quote.IsRealtime,DelayMinutes=quote.ExtendedDelivery=="websocket"?null:quote.DelayMinutes, PreviousClose = double.IsFinite(quote.Price) && quote.Price > 0 ? quote.Price : null, AsOf = at }, true, session);
    }
    public bool Stale(DateTimeOffset now, bool failed = false)
    {
        if (failed || Snapshot.StreamState=="reconnecting" || QuoteStaleness.Check(Snapshot, now) != StaleReason.None) return true;
        return IsExtended && (MarketClock.GetSession(now) is MarketSession.PreMarket or MarketSession.AfterHours)
            && Snapshot.AsOf is { } at && now - at > TimeSpan.FromMinutes(Math.Max(20, Snapshot.DelayMinutes ?? 0));
    }
    public string Reference(Quote original, LocalizationService loc)
    {
        if (IsExtended && original.Price > 0 && double.IsFinite(original.Price))
            return loc["QP_CloseReference"] + " " + NumberDisplay.Price(original.Price) + " · " + (original.AsOf is { } at ? MarketClock.ToEastern(at).ToString("MM-dd HH:mm") + " ET" : loc["Quote_AsOfUnknown"]);
        if (original.ExtendedPrice is > 0 && double.IsFinite(original.ExtendedPrice.Value) && original.ExtendedTime is null)
            return loc["QP_Extended"] + " " + NumberDisplay.Price(original.ExtendedPrice.Value) + " · " + loc["Quote_AsOfUnknown"];
        return "";
    }
}
