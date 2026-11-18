namespace Meili.Analytics;

/// <summary>Single long option at expiry, before fees; premium must be an explicitly chosen observed reference.</summary>
public readonly record struct OptionExpiryReference(double? BreakEven, double? DistanceToBreakEven)
{
    public static OptionExpiryReference ForLong(OptionRight right, double strike, DateOnly expiry, double? premium, double? spot)
    {
        if (!Enum.IsDefined(right) || !double.IsFinite(strike) || strike <= 0 || premium is not { } price || !double.IsFinite(price) || price <= 0) return default;
        var leg = right == OptionRight.Call ? StrategyLeg.Call(PositionSide.Long, strike, price, expiry) : StrategyLeg.Put(PositionSide.Long, strike, price, expiry);
        var roots = new OptionStrategy([leg]).AnalyzeAtExpiry().Breakevens;
        if (roots.Count == 0 || !double.IsFinite(roots[0])) return default;
        var be = roots[0];
        double? distance = spot is > 0 && double.IsFinite(spot.Value) ? (be - spot.Value) / spot.Value : null;
        return new(be, distance is { } d && double.IsFinite(d) ? d : null);
    }
}
