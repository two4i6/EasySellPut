namespace Meili.Shared.Services;

public sealed record StorageSegmentView(string Id, string Label, string Value, double Fraction, long Bytes)
{
    public string Description => Label + " · " + Value;
    public string BrushKey => "Storage" + char.ToUpperInvariant(Id[0]) + Id[1..] + "Brush";
    public static string FormatBytes(long bytes)
    {
        string[] units = ["B", "KB", "MB", "GB", "TB"];
        double size = bytes; var unit = 0;
        while (size >= 1024 && unit < units.Length - 1) { size /= 1024; unit++; }
        return size.ToString(unit == 0 ? "0" : "0.##", System.Globalization.CultureInfo.CurrentCulture) + " " + units[unit];
    }
}
