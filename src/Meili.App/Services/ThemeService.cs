using System.Windows;
using System.Windows.Media;
using Meili.Core.Settings;
using Wpf.Ui.Appearance;
using Wpf.Ui.Controls;

namespace Meili.App.Services;

/// <summary>Light/dark/system theme via WPF-UI, plus the up/down price colour brushes.</summary>
public sealed class ThemeService : IThemeController
{
    void IThemeController.Apply(AppThemeMode mode) => Apply(mode);
    void IThemeController.ApplyUpDownColors(UpDownColorMode mode) => ApplyUpDownColors(mode);

    /// <summary>
    /// 0.4.1: solid window background instead of Mica. WPF-UI only re-tints a Mica backdrop reliably at startup;
    /// after a runtime light/dark switch the transparent title bar and navigation pane kept showing the old tint
    /// (lepoco/wpfui #927, #1163, #1222, #1639). With no backdrop every surface is a theme brush and switches with it.
    /// </summary>
    public const WindowBackdropType Backdrop = WindowBackdropType.None;

    private Window? _watched;
    public AppThemeMode Mode { get; private set; } = AppThemeMode.System;
    public event EventHandler? ThemeChanged;

    public bool IsDark => ApplicationThemeManager.GetAppTheme() == ApplicationTheme.Dark;

    // Every actual palette change, including system changes, publishes the cached semantic palette.
    public ThemeService() => ApplicationThemeManager.Changed += (_, _) =>
    {
        ApplySemanticColors(IsDark);
        ThemeChanged?.Invoke(this, EventArgs.Empty);
    };

    /// <summary>
    /// Switches the WPF-UI theme dictionary at application level only. Pages and the window resolve every brush
    /// through DynamicResource against <see cref="Application.Resources"/>; nothing is copied onto elements
    /// (0.4.0 called ApplicationThemeManager.Apply(window), which snapshots the application resources into the
    /// window and left stale up/down, row and ITM brushes plus the old string dictionary shadowing the new ones).
    /// </summary>
    public void Apply(AppThemeMode mode, Window? mainWindow = null)
    {
        if (mode is AppThemeMode.Light or AppThemeMode.Dark && Mode == mode
            && IsDark == (mode == AppThemeMode.Dark) && _installed == (IsDark, _upDown)) return;
        Mode = mode;
        mainWindow ??= Application.Current.MainWindow;
        ClearWatch();

        // Our token palette owns accent colors; WPF-UI accent updates otherwise write dozens of root resources.
        switch (mode)
        {
            case AppThemeMode.Light: ApplicationThemeManager.Apply(ApplicationTheme.Light, Backdrop, false); break;
            case AppThemeMode.Dark: ApplicationThemeManager.Apply(ApplicationTheme.Dark, Backdrop, false); break;
            default:
                // WPF-UI's system variant always asks for Mica; reset the window to the solid background afterwards.
                ApplicationThemeManager.ApplySystemTheme(false);
                WindowBackgroundManager.UpdateBackground(mainWindow, ApplicationThemeManager.GetAppTheme(), Backdrop);
                if (mainWindow is not null && mainWindow.IsLoaded)
                {
                    SystemThemeWatcher.Watch(mainWindow, Backdrop, false);
                    _watched = mainWindow;
                    mainWindow.Closing += OnWatchedClosing;
                }
                break;
        }
    }

    private void ClearWatch()
    {
        if(_watched is not { } window)return;
        window.Closing-=OnWatchedClosing;
        // WPF-UI rejects unloaded handles. Normal close detaches earlier in Closing.
        if(window.IsLoaded)SystemThemeWatcher.UnWatch(window);
        _watched=null;
    }
    private void OnWatchedClosing(object? sender,System.ComponentModel.CancelEventArgs e)
    {
        // MainWindow's close policy runs first: a canceled close still needs its watcher.
        if(!e.Cancel&&ReferenceEquals(sender,_watched))ClearWatch();
    }

    /// <summary>Quick toggle from the title bar: flips to the opposite explicit theme.</summary>
    public AppThemeMode Toggle() => IsDark ? AppThemeMode.Light : AppThemeMode.Dark;

    private static UpDownColorMode _upDown = UpDownColorMode.RedUp;

    /// <summary>Up/down colours for the chosen convention, in the tones of the active theme (E4 contrast).</summary>
    public static void ApplyUpDownColors(UpDownColorMode mode)
    {
        _upDown = mode;
        ApplySemanticColors(ApplicationThemeManager.GetAppTheme() == ApplicationTheme.Dark);
    }

    /// <summary>Raised after the up/down and health brushes were replaced; view models holding one re-fetch it.</summary>
    public static event EventHandler? ColorsChanged;

    /// <summary>
    /// Installs one complete, frozen, cached palette above WPF-UI's Fluent resources. One dictionary replacement
    /// avoids a global invalidation per brush. Called after native/system changes; redundant calls are no-ops.
    /// Never copies resources onto windows or pages.
    /// </summary>
    public static void ApplySemanticColors(bool dark)
    {
        var resources = Application.Current.Resources;
        if (!ReferenceEquals(_resourceOwner, resources))
        {
            _resourceOwner = resources; _semanticHost = new ResourceDictionary(); _installed = null; _palettes.Clear();
        }
        var key = (dark, _upDown);
        if (!_palettes.TryGetValue(key, out var palette)) _palettes[key] = palette = CreatePalette(dark, _upDown);
        var hosted = resources.MergedDictionaries.Contains(_semanticHost!);
        var last = resources.MergedDictionaries.Count > 0 && ReferenceEquals(resources.MergedDictionaries[^1], _semanticHost);
        if (hosted && last && _installed == key) return;
        if (_semanticHost!.MergedDictionaries.Count == 0) _semanticHost.MergedDictionaries.Add(palette);
        else _semanticHost.MergedDictionaries[0] = palette;
        if (!last)
        {
            if (hosted) resources.MergedDictionaries.Remove(_semanticHost);
            resources.MergedDictionaries.Add(_semanticHost);
        }
        _installed = key;
        ColorsChanged?.Invoke(null, EventArgs.Empty);
    }

    private static ResourceDictionary? _resourceOwner, _semanticHost;
    private static (bool Dark, UpDownColorMode Mode)? _installed;
    private static readonly Dictionary<(bool Dark, UpDownColorMode Mode), ResourceDictionary> _palettes = new();
    private static ResourceDictionary CreatePalette(bool dark, UpDownColorMode mode)
    {
        var dict = new ResourceDictionary();
        void Set(string name, uint argb) { var brush = new SolidColorBrush(C(argb)); brush.Freeze(); dict[name] = brush; }
        var p = ThemePalette.For(dark);
        foreach (var (name, argb) in p.ResourceBrushes()) Set(name, argb);
        var (up, down) = p.UpDown(mode);
        Set("UpBrush", up); Set("DownBrush", down);
        Set("UpBackgroundBrush", ThemePalette.Tint(up)); Set("DownBackgroundBrush", ThemePalette.Tint(down));
        Set("HealthyBrush", p.Healthy); Set("DegradedBrush", p.Degraded); Set("DownStateBrush", p.DownState);
        Set("UnknownBrush", p.Unknown); Set("RowHighlightBrush", p.RowHighlight); Set("ItmBrush", p.ItmTint);
        dict["ApplicationBackgroundColor"] = C(p.Window);
        dict["SystemAccentColor"] = C(p.Accent); dict["SystemAccentColorPrimary"] = C(p.Accent);
        return dict;
    }

    private static Color C(uint argb) => Color.FromArgb((byte)(argb >> 24), (byte)(argb >> 16), (byte)(argb >> 8), (byte)argb);


}

/// <summary>E4: the shared <see cref="SemanticColors"/> as WPF colours.</summary>
public sealed record SemanticPalette(Color Red, Color Green, Color Healthy, Color Degraded, Color DownState, Color Unknown, Color RowHighlight,
    Color ItmTint, Color Placeholder)
{
    private static Color C(uint argb) => Color.FromArgb((byte)(argb >> 24), (byte)(argb >> 16), (byte)(argb >> 8), (byte)argb);

    private static SemanticPalette From(SemanticColors c) => new(C(c.Red), C(c.Green), C(c.Healthy), C(c.Degraded), C(c.DownState),
        C(c.Unknown), C(c.RowHighlight), C(c.ItmTint), C(c.Placeholder));

    public static readonly SemanticPalette Light = From(SemanticColors.Light);
    public static readonly SemanticPalette Dark = From(SemanticColors.Dark);

    /// <summary>Badge fill behind BadgeText, e.g. the stale-quote tag; the same in both themes.</summary>
    public static readonly Color Badge = C(SemanticColors.Badge);

    /// <summary>Alpha of the up/down tag fills behind up/down text.</summary>
    public const byte TintAlpha = SemanticColors.TintAlpha;

    public static SemanticPalette For(bool dark) => dark ? Dark : Light;
}
