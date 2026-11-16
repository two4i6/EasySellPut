using Avalonia;
using Meili.Mac.Platform;

namespace Meili.Mac.Tests;

public sealed class QuotePanelPlacementTests
{
    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public void Centers_below_the_clicked_item_without_scaling_the_display_origin(double scale)
    {
        var screen = new PixelRect(-2560, -1440, (int)(1920 * scale), (int)(1080 * scale));
        var work = new PixelRect(screen.X, screen.Y + (int)(24 * scale), screen.Width, screen.Height - (int)(24 * scale));
        var point = QuotePanelPlacement.Place(screen, work, scale, 360, 640, new StatusItemAnchor(2, 1000, 24));
        Assert.Equal(screen.X + (int)(1000 * scale), point.X + (int)(180 * scale));
        Assert.Equal(screen.Y + (int)(28 * scale), point.Y);
    }

    [Theory]
    [InlineData(5, 8)]
    [InlineData(1915, 1552)]
    public void Stays_inside_the_clicked_display_at_either_edge(double anchorX, int expectedX)
    {
        var screen = new PixelRect(0, 0, 1920, 1080);
        var point = QuotePanelPlacement.Place(screen, new(0, 24, 1920, 1056), 1, 360, 640, new(1, anchorX, 24));
        Assert.Equal(expectedX, point.X);
        Assert.Equal(28, point.Y);
    }
}
