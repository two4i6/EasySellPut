using Avalonia;

namespace Meili.Mac.Platform;

public readonly record struct StatusItemAnchor(long DisplayId, double X, double Y);

/// <summary>Display-local AppKit points to Avalonia pixels, centered under the status item.</summary>
internal static class QuotePanelPlacement
{
    internal static PixelPoint Place(PixelRect screen, PixelRect work, double scale,
        double width, double height, StatusItemAnchor? anchor)
    {
        var gap = (int)Math.Ceiling(4 * scale);
        var margin = (int)Math.Ceiling(8 * scale);
        var w = (int)Math.Ceiling(width * scale);
        var h = (int)Math.Ceiling(height * scale);
        var x = anchor is { } a ? screen.X + (int)Math.Round(a.X * scale) - w / 2 : work.Right - w - margin;
        var y = anchor is { } b ? screen.Y + (int)Math.Round(b.Y * scale) + gap : work.Y + gap;
        return new(Math.Clamp(x, work.X + margin, Math.Max(work.X + margin, work.Right - w - margin)),
            Math.Clamp(y, work.Y + gap, Math.Max(work.Y + gap, work.Bottom - h - margin)));
    }
}
