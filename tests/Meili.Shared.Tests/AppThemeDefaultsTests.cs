using System.Text.Json;
using Meili.Automation.Modules;
using ScottPlot;
namespace Meili.Shared.Tests;
public sealed class AppThemeDefaultsTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Trading_text_and_quote_actions_keep_readable_contrast(bool dark)
    {
        var theme = AppThemeDefaults.Create(dark);
        uint C(string key) => 0xff000000 | Convert.ToUInt32(theme[key]!.GetValue<string>()[1..], 16);
        foreach (var surface in new[] { "tradingCanvas", "tradingSurface" })
        foreach (var text in new[] { "text", "tradingMuted", "buyQuote", "sellQuote" })
            Assert.True(PaletteContrastTests.Contrast(C(text), C(surface)) >= 4.5, text + " on " + surface);
        foreach (var action in new[] { "buyQuote", "sellQuote" })
        {
            var fg = C(action); var bg = C("tradingSurface");
            uint Blend(int shift) => (uint)Math.Round(((fg >> shift) & 255) * .17 + ((bg >> shift) & 255) * .83);
            var tint = 0xff000000 | (Blend(16) << 16) | (Blend(8) << 8) | Blend(0);
            Assert.True(PaletteContrastTests.Contrast(fg, tint) >= 4.5, action + " on quote tint");
            Assert.True(PaletteContrastTests.Contrast(C("tradingCanvas"), fg) >= 4.5, "Selected " + action);
        }
    }
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Native_and_headless_defaults_share_component_roles_and_isolated_snapshots(bool dark)
    {
        var defaults=AppThemeDefaults.Create(dark);
        var palette=ChartPalette.Create(dark,new Color(1,2,3),new Color(4,5,6),new Color(7,8,9),new Color(10,11,12),ThemePalette.For(dark));
        var native=JsonSerializer.SerializeToElement(WebChartSnapshot.Theme(palette));
        foreach(var role in new[]{"accent","border","control","sessionPre","sessionPost"})
            Assert.Equal(defaults[role]!.ToJsonString(),native.GetProperty(role).GetRawText());
        Assert.Equal("#010203",native.GetProperty("up").GetString());
        Assert.Equal("#040506",native.GetProperty("down").GetString());
        defaults["accent"]="changed";defaults["colors"]![0]="changed";
        var next=AppThemeDefaults.Create(dark,true);
        Assert.NotEqual("changed",next["accent"]!.GetValue<string>());
        Assert.NotEqual("changed",next["colors"]![0]!.GetValue<string>());
        Assert.True(next["reducedMotion"]!.GetValue<bool>());
    }
}
