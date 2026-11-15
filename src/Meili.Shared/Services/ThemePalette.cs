namespace Meili.Shared.Services;

/// <summary>
/// Chart-workspace colour tokens: neutral surfaces and blue actions. This is the single source both front ends and
/// <see cref="ChartPalette"/> read (0xAARRGGBB).
/// </summary>
public sealed record ThemePalette(
    uint Window, uint Sidebar, uint Card, uint Chart, uint Control, uint Border,
    uint PrimaryText, uint SecondaryText, uint MutedText,
    uint Up, uint Down, uint Healthy, uint Degraded, uint DownState, uint Unknown,
    uint Accent, uint OnAccent, uint RowHighlight, uint ItmTint, uint Placeholder,
    uint Badge, uint BadgeText, uint ErrorBar, uint InfoBar,
    byte GridAlpha,
    uint Series1, uint Series2, uint Series3, uint Series4, uint Series5, uint Series6, uint PreMarketTint, uint AfterHoursTint)
{
    /// <summary>Alpha of the up/down tag fills behind up/down text.</summary>
    // 0x1A left dark-theme Down on the card fill at 4.49:1; 0x18 (~9%) restores 2265 4.5:1.
    public const byte TintAlpha = 0x18;

    public static readonly ThemePalette Dark = new(
        Window: 0xFF131722, Sidebar: 0xFF1E222D, Card: 0xFF1E222D, Chart: 0xFF131722, Control: 0xFF2A2E39, Border: 0xFF363A45,
        PrimaryText: 0xFFD1D4DC, SecondaryText: 0xFFB2B5BE, MutedText: 0xFFA3A9B5,
        Up: 0xFFCC8E8A, Down: 0xFF6EAA8A, Healthy: 0xFF7EA6C0, Degraded: 0xFFC4A46A, DownState: 0xFF9A958C, Unknown: 0xFF9A958C,
        Accent: 0xFF90B2FF, OnAccent: 0xFF131722, RowHighlight: 0xFF2A2E39, ItmTint: 0x2290B2FF, Placeholder: 0xFFA3A9B5,
        Badge: 0xFFC4A46A, BadgeText: 0xFF131722, ErrorBar: 0xFF3A2A28, InfoBar: 0xFF222B40,
        GridAlpha: 0x1F,
        Series1: 0xFF7BA8C0, Series2: 0xFFC9A06A, Series3: 0xFFBAA8C6, Series4: 0xFF6AADC0, Series5: 0xFFC4909E, Series6: 0xFFB4A072, PreMarketTint: 0x248EA4EF, AfterHoursTint: 0x24D5A451);

    public static readonly ThemePalette Light = new(
        Window: 0xFFF0F3FA, Sidebar: 0xFFFFFFFF, Card: 0xFFFFFFFF, Chart: 0xFFFFFFFF, Control: 0xFFF8F9FD, Border: 0xFFE0E3EB,
        PrimaryText: 0xFF131722, SecondaryText: 0xFF434651, MutedText: 0xFF565D6B,
        Up: 0xFFA83E38, Down: 0xFF1A7050, Healthy: 0xFF1A5F96, Degraded: 0xFF7A5500, DownState: 0xFF434651, Unknown: 0xFF434651,
        Accent: 0xFF245BDB, OnAccent: 0xFFFFFFFF, RowHighlight: 0xFFE8EEFF, ItmTint: 0x15245BDB, Placeholder: 0xFF565D6B,
        Badge: 0xFFC4A46A, BadgeText: 0xFF131722, ErrorBar: 0xFFF4E4DC, InfoBar: 0xFFEDF2FF,
        GridAlpha: 0x1F,
        Series1: 0xFF1C648E, Series2: 0xFF8E4E00, Series3: 0xFF5E3F8A, Series4: 0xFF0C6262, Series5: 0xFF8E3F68, Series6: 0xFF6A4E10, PreMarketTint: 0x1C7389CF, AfterHoursTint: 0x1FCC9830);

    public static ThemePalette For(bool dark) => dark ? Dark : Light;

    /// <summary>The up and down colours for a convention (red-up for China, green-up for the US).</summary>
    public (uint Up, uint Down) UpDown(Meili.Core.Settings.UpDownColorMode mode) =>
        mode == Meili.Core.Settings.UpDownColorMode.RedUp ? (Up, Down) : (Down, Up);

    public static uint Tint(uint color) => ((uint)TintAlpha << 24) | (color & 0x00FFFFFF);

    /// <summary>
    /// Resource keys both front ends install after a theme apply (and that macOS ThemeDictionaries mirror).
    /// WPF-UI resets the Fluent keys to #202020/#FFFFFF on every Apply; these must be written afterwards.
    /// </summary>
    public IEnumerable<(string Key, uint Argb)> ResourceBrushes()
    {
        var accentHover = (0xCC000000) | (Accent & 0x00FFFFFF);
        var accentPressed = (0x99000000) | (Accent & 0x00FFFFFF);
        return
        [
            ("ApplicationBackgroundBrush", Window),
            ("WindowBackground", Window),
            ("SidebarBackgroundBrush", Sidebar),
            ("CardBackgroundFillColorDefaultBrush", Card),
            ("CardBackgroundFillColorSecondaryBrush", Card),
            ("SolidBackgroundFillColorBaseBrush", Window),
            ("SolidBackgroundFillColorSecondaryBrush", Card),
            ("SolidBackgroundFillColorTertiaryBrush", Control),
            ("SolidBackgroundFillColorQuarternaryBrush", Control),
            ("SolidBackgroundFillColorBaseAltBrush", Sidebar),
            ("LayerFillColorDefaultBrush", Window),
            ("LayerFillColorAltBrush", Card),
            ("NavigationViewContentBackground", Window),
            ("LoadingScreenBackground", Window),
            ("ControlFillColorDefaultBrush", Control),
            ("ControlFillColorSecondaryBrush", Control),
            ("ControlFillColorTertiaryBrush", Control),
            ("ControlFillColorInputActiveBrush", Control),
            ("ControlSolidFillColorDefaultBrush", Control),
            ("ControlStrokeColorDefaultBrush", Border),
            ("ControlStrokeColorSecondaryBrush", Border),
            ("CardStrokeColorDefaultBrush", Border),
            ("CardStrokeColorDefaultSolidBrush", Border),
            ("DividerStrokeColorDefaultBrush", Border),
            ("NavigationViewContentGridBorderBrush", Border),
            ("TextFillColorPrimaryBrush", PrimaryText),
            ("TextFillColorSecondaryBrush", SecondaryText),
            ("TextFillColorTertiaryBrush", MutedText),
            ("TextControlPlaceholderForeground", Placeholder),
            ("AccentFillColorDefaultBrush", Accent),
            ("AccentFillColorSecondaryBrush", accentHover),
            ("AccentFillColorTertiaryBrush", accentPressed),
            ("SystemAccentColorPrimaryBrush", Accent),
            ("SystemAccentColorSecondaryBrush", accentHover),
            ("SystemAccentColorTertiaryBrush", accentPressed),
            ("SystemAccentColorBrush", Accent),
            ("AccentTextFillColorPrimaryBrush", Accent),
            ("TextOnAccentFillColorPrimaryBrush", OnAccent),
            ("NavigationViewSelectionIndicatorForeground", Accent),
            ("ErrorBarBrush", ErrorBar),
            ("InfoBarBrush", InfoBar),
            ("InfoBarErrorSeverityBackgroundBrush", ErrorBar),
            ("InfoBarInformationalSeverityBackgroundBrush", InfoBar),
            ("SystemFillColorCriticalBackgroundBrush", ErrorBar),
            ("SystemFillColorAttentionBackgroundBrush", InfoBar),
            ("StaleBadgeBrush", Badge),
            ("BadgeTextBrush", BadgeText),
        ];
    }
}
