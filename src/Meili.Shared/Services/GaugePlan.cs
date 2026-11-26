namespace Meili.Shared.Services;

public readonly record struct GaugePoint(double X, double Y);
public sealed record GaugePlan(IReadOnlyList<IReadOnlyList<GaugePoint>> Bands, GaugePoint? Marker)
{
    /// <summary>Pure presentation geometry shared by native renderers; missing/non-finite values never become a neutral score.</summary>
    public static GaugePlan Create(double width, double height, double? value)
    {
        var radius = Math.Max(0, Math.Min(width / 2 - DesignTokens.SpaceMD, height - DesignTokens.SpaceMD));
        var centerX = width / 2; var centerY = height - DesignTokens.SpaceMD;
        GaugePoint Point(double fraction) => new(centerX + radius * Math.Cos(Math.PI + Math.PI * fraction), centerY + radius * Math.Sin(Math.PI + Math.PI * fraction));
        double[] boundaries = [0, .3, .6, .8, 1];
        var bands = Enumerable.Range(0, 4).Select(i => (IReadOnlyList<GaugePoint>)Enumerable.Range(0, 25)
            .Select(j => Point(boundaries[i] + (boundaries[i + 1] - boundaries[i]) * j / 24)).ToArray()).ToArray();
        return new(bands, value is { } v && double.IsFinite(v) ? Point(Math.Clamp(v, 0, 100) / 100) : null);
    }
}
