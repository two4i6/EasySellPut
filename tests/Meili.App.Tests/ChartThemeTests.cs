using System.Net.Http;
using System.Text.Json;
using Meili.App.Views.Controls;
using System.IO;
using System.Windows.Controls;
using ScottPlot.WPF;
using Meili.App.Services;
using Meili.App.Views.Pages;
using Meili.Core.Settings;
using MColor = System.Windows.Media.Color;

namespace Meili.App.Tests;

/// <summary>E5: ScottPlot charts repaint with the new theme and up/down colours, without reopening the page.</summary>
public class ChartThemeTests
{
    private static MColor M(ScottPlot.Color c) => MColor.FromRgb(c.R, c.G, c.B);

    [Fact]
    public void Series_colours_keep_3_to_1_contrast_on_the_plot_background_in_both_themes()
    {
        WpfHost.Run(() =>
        {
            try
            {
                foreach (var dark in new[] { true, false })
                {
                    ScreenRenderTests.Apply("zh-CN", dark);
                    var c = WpfChartPalette.Current(dark);
                    foreach (var s in new[] { c.Series1, c.Series2, c.Series3, c.Series4, c.Series5, c.Series6, c.Marker, c.Up, c.Down })
                        Assert.True(UiAudit.Contrast(M(s), M(c.DataBackground)) >= 3, $"{(dark ? "dark" : "light")} {s.ToHex()}");
                    Assert.True(UiAudit.Contrast(M(c.Text), M(c.Background)) >= 4.5);
                }
            }
            finally { ScreenRenderTests.Apply("zh-CN", true); }
        });
    }

    [Fact]
    public void Kline_page_forwards_runtime_theme_and_up_down_colors_to_the_local_webview_session()
    {
        WpfHost.Run(async () =>
        {
            try
            {
                ScreenRenderTests.Apply("zh-CN", true);
                var page = new ChartsPage();
                using var host = new OffscreenHost(page, 1280, 800);
                await ScreenRenderTests.Settle();
                var web = UiAudit.Descendants<WebChartControl>(page).Single();
                using var http = new HttpClient(new HttpClientHandler { UseProxy = false });
                async Task<string?> Field(string key)
                {
                    using var json = JsonDocument.Parse(await http.GetStringAsync(new Uri(web.Session!.PageUri, "state")));
                    return json.RootElement.GetProperty("data").GetProperty("theme").GetProperty(key).GetString();
                }
                Assert.Equal("#201E1C", await Field("background"));
                ScreenRenderTests.Apply("zh-CN", false);
                ThemeService.ApplyUpDownColors(UpDownColorMode.GreenUp);
                await ScreenRenderTests.Settle();
                Assert.Equal("#F6F0E3", await Field("background"));
                Assert.Equal("#1A7050", await Field("up"));
            }
            finally
            {
                ThemeService.ApplyUpDownColors(AppServices.Get<SettingsStore>().Current.UpDownColors);
                ScreenRenderTests.Apply("zh-CN", true);
            }
        });
    }

    [Fact]
    public void Reader_chrome_uses_live_resources_and_localized_error_state()
    {
        WpfHost.Run(() =>
        {
            var loc = LocalizationService.Current;
            var reader = new NewsReaderWindow();
            try
            {
                var root = (DockPanel)reader.Content;
                var status = root.Children.OfType<TextBlock>().Single();
                var toolbar = root.Children.OfType<WrapPanel>().Single();
                Assert.Equal(System.Windows.Visibility.Collapsed, status.Visibility);
                foreach (var dark in new[] { true, false })
                {
                    ScreenRenderTests.Apply("zh-CN", dark);
                    var palette = ThemePalette.For(dark);
                    Assert.Equal(MColor.FromRgb((byte)(palette.Window >> 16), (byte)(palette.Window >> 8), (byte)palette.Window), ((System.Windows.Media.SolidColorBrush)reader.Background).Color);
                    reader.OpenArticle("file:///blocked", "Blocked");
                    Assert.Equal(System.Windows.Visibility.Visible, status.Visibility);
                    Assert.Equal(loc["Reader_Blocked"], status.Text);
                    Assert.All(toolbar.Children.OfType<Wpf.Ui.Controls.Button>(), b => Assert.True(b.FontSize >= 14 && b.MinHeight >= 32));
                }
                loc.Apply("en-US");
                Assert.Equal(loc["Reader_Blocked"], status.Text);
            }
            finally { reader.Close(); loc.Apply("zh-CN"); ScreenRenderTests.Apply("zh-CN", true); }
        });
    }

    [Theory]
    [InlineData(typeof(OptionsPage))]
    [InlineData(typeof(StrategyPage))]
    public void Open_chart_follows_theme_and_up_down_switches(Type pageType)
    {
        var dir = Environment.GetEnvironmentVariable("MEILI_RENDER_DIR");
        WpfHost.Run(async () =>
        {
            var name = pageType.Name.Replace("Page", "").ToLowerInvariant();
            try
            {
                ScreenRenderTests.Apply("zh-CN", true);
                var page = (Page)Activator.CreateInstance(pageType)!;
                using var host = new OffscreenHost(page, 1280, 800);
                await ScreenRenderTests.Settle();
                var plot = UiAudit.Descendants<WpfPlot>(page).First(p => p.IsVisible);
                Assert.Equal(WpfChartPalette.Current(true).Background, plot.Plot.FigureBackground.Color);
                if (dir is { Length: > 0 }) host.SavePng(Path.Combine(dir, $"e5-{name}-1-dark.png"));

                ScreenRenderTests.Apply("zh-CN", false);                        // switch while the page is open
                await ScreenRenderTests.Settle();
                var light = WpfChartPalette.Current(false);
                Assert.Equal(light.Background, plot.Plot.FigureBackground.Color);
                Assert.Equal(light.DataBackground, plot.Plot.DataBackground.Color);
                if (dir is { Length: > 0 }) host.SavePng(Path.Combine(dir, $"e5-{name}-2-light.png"));


            }
            finally
            {
                ThemeService.ApplyUpDownColors(AppServices.Get<SettingsStore>().Current.UpDownColors);
                ScreenRenderTests.Apply("zh-CN", true);
            }
        });
    }
}
