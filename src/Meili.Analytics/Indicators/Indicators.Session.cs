namespace Meili.Analytics;

public static partial class Indicators
{
    /// <summary>Ratio of observed cumulative volume to mean cumulative volume over comparable earlier sessions.</summary>
    public static double? RelativeVolume(double currentVolume, IReadOnlyList<double> comparableVolumes)
    {
        if (!double.IsFinite(currentVolume) || currentVolume <= 0 || comparableVolumes.Count == 0) return null;
        var mean = comparableVolumes.Average();
        if (!double.IsFinite(mean) || mean <= 0) return null;
        var ratio = currentVolume / mean;
        return double.IsFinite(ratio) ? ratio : null;
    }

    /// <summary>Position of the price within the high-low range on a scale of zero to one.</summary>
    public static double? RangePosition(double price, double low, double high)
    {
        if (!double.IsFinite(price) || !double.IsFinite(low) || !double.IsFinite(high) ||
            low <= 0 || high <= low || price <= 0) return null;
        return Math.Clamp((price - low) / (high - low), 0, 1);
    }
}
