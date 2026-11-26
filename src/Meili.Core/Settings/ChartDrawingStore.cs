using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;

namespace Meili.Core.Settings;

public enum DrawingKind { HorizontalLine, TrendLine, HorizontalRay, VerticalLine, Rectangle, FibonacciRetracement, LongPosition, ShortPosition, PriceRange }

public static class DrawingKinds
{
    public static bool NeedsSecondAnchor(this DrawingKind kind) =>
        kind is DrawingKind.TrendLine or DrawingKind.Rectangle or DrawingKind.FibonacciRetracement or DrawingKind.PriceRange || kind.IsPosition();

    public static bool NeedsFirstTime(this DrawingKind kind) => kind is not (DrawingKind.HorizontalLine or DrawingKind.PriceRange);

    public static bool NeedsSecondTime(this DrawingKind kind) => kind.NeedsSecondAnchor() && kind.NeedsFirstTime();

    public static bool IsPosition(this DrawingKind kind) => kind is DrawingKind.LongPosition or DrawingKind.ShortPosition;

    public static bool IsTarget(this DrawingKind kind, double entry, double target) =>
        kind == DrawingKind.LongPosition ? target > entry : target < entry;

    public static bool IsStop(this DrawingKind kind, double entry, double stop) =>
        kind == DrawingKind.LongPosition ? stop < entry : stop > entry;

    public static bool NeedsDistinctPrices(this DrawingKind kind) =>
        kind is DrawingKind.Rectangle or DrawingKind.FibonacciRetracement or DrawingKind.PriceRange;
}

/// <summary>B5: a line the user drew on a symbol's K-line chart. A horizontal line only uses <see cref="Price1"/>.</summary>
public sealed record ChartDrawing(DrawingKind Kind, double Price1, DateTimeOffset? Time1 = null, double Price2 = 0, DateTimeOffset? Time2 = null)
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? StopPrice { get; init; }
}

/// <summary>B5: drawings per symbol in <c>drawings.json</c> (single thread per instance; cross-process writes detect stale snapshots).</summary>
public sealed class ChartDrawingStore
{
    private static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() },
    };

    private readonly SnapshotFile _snapshot;
    private Dictionary<string, List<ChartDrawing>> _bySymbol = new(StringComparer.OrdinalIgnoreCase);
    public string FilePath { get; }

    public ChartDrawingStore(string dataDirectory)
    {
        Directory.CreateDirectory(dataDirectory);
        FilePath = Path.Combine(dataDirectory, "drawings.json");
        _snapshot = new SnapshotFile(FilePath);
        if (!File.Exists(FilePath)) return;
        try
        {
            var loaded = JsonSerializer.Deserialize<Dictionary<string, List<ChartDrawing>>>(_snapshot.Read()!, Json);
            if (loaded is not null) _bySymbol = new(loaded, StringComparer.OrdinalIgnoreCase);
        }
        catch (Exception ex) when (ex is JsonException or IOException)
        {
            Diagnostics.AppLog.Error("drawings", $"{FilePath} is unreadable, starting without drawings", ex);
        }
    }

    public IReadOnlyList<ChartDrawing> For(string symbol) => _bySymbol.TryGetValue(symbol, out var list) ? list : [];

    public void Add(string symbol, ChartDrawing drawing)
    {
        Validate(drawing);
        if (For(symbol).Count >= 200) throw new ArgumentException("At most 200 drawings per symbol.");
        var updated = _bySymbol.ToDictionary(p=>p.Key,p=>new List<ChartDrawing>(p.Value),StringComparer.OrdinalIgnoreCase);
        if (!updated.TryGetValue(symbol, out var list)) updated[symbol] = list = [];
        list.Add(drawing);
        Save(updated);
    }

    public string Revision(string symbol) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(For(symbol), Json))));
    public void Edit(string symbol, int index, ChartDrawing? replacement, string revision)
    {
        if (Revision(symbol) != revision) throw new DataConflictException(FilePath);
        if (index < 0 || index >= For(symbol).Count) throw new ArgumentOutOfRangeException(nameof(index));
        if (replacement is not null) Validate(replacement);
        var updated = _bySymbol.ToDictionary(p => p.Key, p => new List<ChartDrawing>(p.Value), StringComparer.OrdinalIgnoreCase);
        if (replacement is null) updated[symbol].RemoveAt(index); else updated[symbol][index] = replacement;
        Save(updated);
    }
    public static void Validate(ChartDrawing drawing)
    {
        if (!Enum.IsDefined(drawing.Kind) || !double.IsFinite(drawing.Price1) || drawing.Price1 < 0 || drawing.Price1 > 1e12 ||
            !double.IsFinite(drawing.Price2) || drawing.Price2 < 0 || drawing.Price2 > 1e12 ||
            drawing.Kind.NeedsFirstTime() && drawing.Time1 is null ||
            drawing.Kind.NeedsSecondTime() && (drawing.Time2 is null || drawing.Time1 == drawing.Time2) ||
            drawing.Kind.NeedsDistinctPrices() && drawing.Price1 == drawing.Price2)
            throw new ArgumentException("Invalid drawing anchors.");
        if (drawing.Kind.IsPosition() && (drawing.StopPrice is not { } stop || !double.IsFinite(stop) ||
            stop is < 0 or > 1e12 || !drawing.Kind.IsTarget(drawing.Price1, drawing.Price2) ||
            !drawing.Kind.IsStop(drawing.Price1, stop)))
            throw new ArgumentException("A position needs a target and stop on opposite sides of entry, consistent with its direction.");
    }
    public void Clear(string symbol)
    {
        var updated = _bySymbol.ToDictionary(p=>p.Key,p=>new List<ChartDrawing>(p.Value),StringComparer.OrdinalIgnoreCase);
        if (updated.Remove(symbol)) Save(updated);
    }

    private void Save(Dictionary<string,List<ChartDrawing>> updated)
    {
        _snapshot.Write(JsonSerializer.Serialize(updated,Json));
        _bySymbol=updated;
    }
}
