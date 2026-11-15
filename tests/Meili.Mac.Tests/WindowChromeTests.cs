using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Chrome;
using Avalonia.Headless.XUnit;
using Avalonia.Media;
using Avalonia.VisualTree;
using Meili.Core.Settings;
using Meili.Mac.Platform;
namespace Meili.Mac.Tests;
public sealed class WindowChromeTests
{
    [AvaloniaFact] public void Title_band_preserves_content_safe_area_and_tracks_live_theme_and_locale()
    {
        MacHost.EnsureComposed();var window=new MainWindow();window.Show();
        try
        {
            var header=window.FindControl<Border>("WindowHeader")!;
            Assert.True(window.ExtendClientAreaToDecorationsHint);Assert.Equal(Avalonia.Input.WindowDecorationsElementRole.TitleBar,WindowDecorationProperties.GetElementRole(header));
            Assert.Equal(window.IsExtendedIntoWindowDecorations,header.IsVisible);
            foreach(var language in new[]{"zh-CN","en-US"})foreach(var dark in new[]{false,true})foreach(var width in new[]{980,1440})
            {
                LocalizationService.Current.Apply(language);AppServices.Get<MacTheme>().Apply(dark?AppThemeMode.Dark:AppThemeMode.Light);window.Width=width;
                // Headless has no OS decorations; render the real app band explicitly, without inventing traffic lights.
                header.IsVisible=true;MacHost.Pump();
                Assert.Equal(DesignTokens.WindowHeaderHeight,header.Bounds.Height);
                Assert.Equal(ThemePalette.For(dark).Window,((ISolidColorBrush)header.Background!).Color.ToUInt32());
                var title=header.GetVisualDescendants().OfType<TextBlock>().Single();Assert.Equal(LocalizationService.Current["App_Title"],title.Text);
                var p=title.TranslatePoint(new Point(title.Bounds.Width/2,title.Bounds.Height/2),window)!.Value;
                Assert.InRange(Math.Abs(p.X-window.ClientSize.Width/2),0,1);Assert.InRange(Math.Abs(p.Y-header.Bounds.Height/2),0,1);
                Assert.True(window.FindControl<ContentControl>("PageHost")!.TranslatePoint(default,window)!.Value.Y>=header.Bounds.Bottom);
                MacHost.Save(window,$"window-chrome-{width}-{language}-{dark}");
            }
            window.WindowState=WindowState.FullScreen;MacHost.Pump();Assert.False(header.IsVisible);
            window.WindowState=WindowState.Normal;MacHost.Pump();Assert.Equal(window.IsExtendedIntoWindowDecorations,header.IsVisible);
        }
        finally{window.AllowClose();window.Close();LocalizationService.Current.Apply("zh-CN");}
    }
}
