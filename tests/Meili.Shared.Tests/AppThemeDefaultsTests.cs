using System.Text.Json;
using Meili.Automation.Modules;
using ScottPlot;
namespace Meili.Shared.Tests;
public sealed class AppThemeDefaultsTests
{
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
