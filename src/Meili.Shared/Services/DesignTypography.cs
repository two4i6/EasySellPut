using Meili.Core.Settings;

namespace Meili.Shared.Services;

/// <summary>The desktop text preference for native resources and app-owned charts.</summary>
public static class DesignTypography
{
    private const double StandardScale = 0.9;
    public static int Percent { get; private set; } = AppSettings.DefaultTextSizePercent;
    public static double Scale => StandardScale * Percent / 100d;
    public static event EventHandler? Changed;

    public static void Apply(int percent)
    {
        percent = AppSettings.NormalizeTextSize(percent);
        if (Percent == percent) return;
        Percent = percent;
        Changed?.Invoke(null, EventArgs.Empty);
    }

    public static double Size(double baseline) => baseline * Scale;

    public static IEnumerable<(string Key, double Size)> Resources()
    {
        foreach (var (key, size) in DesignTokens.FontSizes)
            yield return (key, Math.Max(DesignTokens.CaptionFontSize, Size(size)));
        yield return ("SymbolInputHeight", DesignTokens.ControlHeight + Math.Max(0, Math.Ceiling((Scale - 1) * DesignTokens.TitleFontSize)));
    }

    public static string ResourceKey(double baseline) =>
        DesignTokens.FontSizes.First(token => token.Size == baseline).Key;
}
