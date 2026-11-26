using Meili.Core.Settings;

namespace Meili.Core.Tests;

public sealed class DrawingEditTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), "meili-drawing-edit-" + Guid.NewGuid().ToString("N"));
    [Fact]
    public void Edit_delete_and_stale_revisions_preserve_other_drawings()
    {
        var store = new ChartDrawingStore(_path);store.Add("AAPL",new(DrawingKind.HorizontalLine,100));store.Add("AAPL",new(DrawingKind.HorizontalLine,200));
        var stale = new ChartDrawingStore(_path);var revision = store.Revision("AAPL");
        store.Edit("AAPL",0,new(DrawingKind.HorizontalLine,110),revision);
        Assert.Equal(200,store.For("AAPL")[1].Price1);
        Assert.Throws<DataConflictException>(()=>store.Edit("AAPL",1,null,revision));
        Assert.Throws<DataConflictException>(()=>stale.Edit("AAPL",0,null,stale.Revision("AAPL")));
        Assert.Equal(2,stale.For("AAPL").Count);
        store.Edit("AAPL",0,null,store.Revision("AAPL"));
        Assert.Equal(200,Assert.Single(new ChartDrawingStore(_path).For("AAPL")).Price1);
        Assert.Throws<ArgumentOutOfRangeException>(()=>store.Edit("AAPL",1,null,store.Revision("AAPL")));
    }
    [Fact]
    public void Rejects_nonfinite_and_same_time_anchors_before_writing()
    {
        var store=new ChartDrawingStore(_path);var time=DateTimeOffset.UtcNow;
        Assert.Throws<ArgumentException>(()=>store.Add("AAPL",new(DrawingKind.TrendLine,10,time,20,time)));
        Assert.Throws<ArgumentException>(()=>store.Add("AAPL",new(DrawingKind.HorizontalLine,double.NaN)));
        Assert.Empty(store.For("AAPL"));Assert.False(File.Exists(store.FilePath));
    }
    [Fact]
    public void New_tools_preserve_their_anchors_and_reject_degenerate_shapes()
    {
        var store = new ChartDrawingStore(_path);
        var start = new DateTimeOffset(2025, 1, 6, 14, 30, 0, TimeSpan.Zero);
        var end = start.AddMinutes(5);
        ChartDrawing[] drawings =
        [
            new(DrawingKind.HorizontalRay, 100, start),
            new(DrawingKind.VerticalLine, 0, end),
            new(DrawingKind.Rectangle, 100, start, 110, end),
            new(DrawingKind.FibonacciRetracement, 110, end, 100, start),
        ];
        Assert.Throws<ArgumentException>(() => store.Add("AAPL", new(DrawingKind.VerticalLine, 0)));
        Assert.Throws<ArgumentException>(() => store.Add("AAPL", drawings[2] with { Price2 = 100 }));
        Assert.Throws<ArgumentException>(() => store.Add("AAPL", drawings[3] with { Time2 = end }));
        foreach (var drawing in drawings) store.Add("AAPL", drawing);

        var reopened = new ChartDrawingStore(_path);
        Assert.Equal(drawings, reopened.For("AAPL"));
        reopened.Edit("AAPL", 1, drawings[1] with { Time1 = start }, reopened.Revision("AAPL"));
        Assert.Equal(start, new ChartDrawingStore(_path).For("AAPL")[1].Time1);
    }
    [Fact]
    public void Positions_require_directional_levels_and_ranges_can_omit_times()
    {
        var store = new ChartDrawingStore(_path);
        var start = new DateTimeOffset(2025, 1, 6, 14, 30, 0, TimeSpan.Zero);
        var end = start.AddHours(1);
        var longPosition = new ChartDrawing(DrawingKind.LongPosition, 100, start, 115, end) { StopPrice = 95 };
        var shortPosition = new ChartDrawing(DrawingKind.ShortPosition, 110, start, 90, end) { StopPrice = 120 };
        var range = new ChartDrawing(DrawingKind.PriceRange, 120, Price2: 100);
        Assert.Throws<ArgumentException>(() => store.Add("AAPL", longPosition with { StopPrice = null }));
        Assert.Throws<ArgumentException>(() => store.Add("AAPL", shortPosition with { StopPrice = 100 }));
        Assert.Throws<ArgumentException>(() => store.Add("AAPL", shortPosition with { Price2 = 113 }));
        Assert.Throws<ArgumentException>(() => store.Add("AAPL", range with { Price2 = 120 }));
        foreach (var drawing in new[] { longPosition, shortPosition, range }) store.Add("AAPL", drawing);
        Assert.Equal(new[] { longPosition, shortPosition, range }, new ChartDrawingStore(_path).For("AAPL"));
    }
    public void Dispose(){if(Directory.Exists(_path))Directory.Delete(_path,true);}
}
