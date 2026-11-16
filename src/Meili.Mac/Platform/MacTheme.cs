using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Media.Immutable;
using Avalonia.Styling;
using Meili.Core.Settings;

namespace Meili.Mac.Platform;

/// <summary>
/// Light / dark / follow-system (the default) plus the red-up / green-up convention. Surfaces and semantic
/// brushes are prebuilt from <see cref="ThemePalette"/> in native variant dictionaries. Theme changes reuse
/// Avalonia variant resolution without removing/reinstalling application resources; convention changes
/// replace one cached dictionary. The shared tokens remain the source of truth.
/// </summary>
public sealed class MacTheme : IThemeController
{
    private readonly ResourceDictionary _host = new();
    private readonly Dictionary<UpDownColorMode, ResourceDictionary> _palettes = new();
    private (bool Dark, UpDownColorMode Mode)? _published;
    private UpDownColorMode _upDown = UpDownColorMode.RedUp;

    /// <summary>Raised after the effective palette changes; view-models holding a brush fetch it again.</summary>
    public static event EventHandler? ColorsChanged;

    public MacTheme()
    {
        var app = Application.Current!;
        foreach (var mode in Enum.GetValues<UpDownColorMode>())
        {
            var pair = new ResourceDictionary();
            pair.ThemeDictionaries[ThemeVariant.Light] = CreatePalette(false, mode);
            pair.ThemeDictionaries[ThemeVariant.Dark] = CreatePalette(true, mode);
            _palettes.Add(mode, pair);
        }
        _host.MergedDictionaries.Add(_palettes[_upDown]);
        app.Resources.MergedDictionaries.Add(_host);
        // Follows the system appearance (System Settings › Appearance, including Auto) without polling.
        app.ActualThemeVariantChanged += (_, _) => ApplySemanticColors();
        ApplySemanticColors();
    }

    public bool IsDark => Application.Current!.ActualThemeVariant == ThemeVariant.Dark;

    public void Apply(AppThemeMode mode)
    {
        var app = Application.Current!;
        app.RequestedThemeVariant = mode switch { AppThemeMode.Light => ThemeVariant.Light, AppThemeMode.Dark => ThemeVariant.Dark, _ => ThemeVariant.Default };
    }

    public void ApplyUpDownColors(UpDownColorMode mode)
    {
        if (_upDown == mode) return;
        _upDown = mode;
        _host.MergedDictionaries[0] = _palettes[mode];
        ApplySemanticColors();
    }

    private void ApplySemanticColors()
    {
        var state = (IsDark, _upDown);
        if (_published == state) return;
        _published = state;
        ColorsChanged?.Invoke(this, EventArgs.Empty);
    }

    private static ResourceDictionary CreatePalette(bool dark, UpDownColorMode mode)
    {
        var p = ThemePalette.For(dark);
        var (up, down) = p.UpDown(mode);
        var dict = new ResourceDictionary();
        foreach (var (key, argb) in p.ResourceBrushes())
            dict[key] = Brush(argb);
        dict["UpBrush"] = Brush(up);
        dict["DownBrush"] = Brush(down);
        dict["UpBackgroundBrush"] = Brush(ThemePalette.Tint(up));
        dict["DownBackgroundBrush"] = Brush(ThemePalette.Tint(down));
        dict["HealthyBrush"] = Brush(p.Healthy);
        dict["DegradedBrush"] = Brush(p.Degraded);
        dict["DownStateBrush"] = Brush(p.DownState);
        dict["UnknownBrush"] = Brush(p.Unknown);
        dict["RowHighlightBrush"] = Brush(p.RowHighlight);
        dict["ItmBrush"] = Brush(p.ItmTint);
        return dict;
    }

    /// <summary>Immutable brushes: shareable between controls and cheap for the renderer.</summary>
    private static ImmutableSolidColorBrush Brush(uint argb) => new(Color.FromUInt32(argb));
}
