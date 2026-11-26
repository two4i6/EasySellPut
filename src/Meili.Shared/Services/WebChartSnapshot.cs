using System.Text.Json;
using System.Runtime.CompilerServices;
using Meili.Shared.ViewModels;
using Meili.Core.Models;
using Meili.Core.Time;

namespace Meili.Shared.Services;

/// <summary>Desktop-only rendering contract. Indicators come from the same Analytics snapshot as CLI/MCP.</summary>
public static class WebChartSnapshot
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly ConditionalWeakTable<Meili.Analytics.KlineSnapshot, Dictionary<string, ChartStudyLine[]>> StudyCache = new();

    public static string Serialize(ChartsViewModel vm, ChartPalette palette)
    {
        var bars = vm.Series?.Bars;
        var snapshot = vm.Snapshot;
        var indices = bars is null ? [] : Enumerable.Range(0, bars.Count)
            .GroupBy(i => bars[i].Time.ToUnixTimeSeconds()).Select(g => g.Last())
            .OrderBy(i => bars[i].Time).ToArray();
        static double? Finite(double n) => double.IsFinite(n) ? n : null;
        var rows = indices.Select(i =>
        {
            var b = bars![i];
            var complete = !b.Incomplete && b.IsConsistent();
            return new
            {
                time = b.Time.ToUnixTimeSeconds(), index = i,
                session = vm.Series!.Interval.IsIntraday() ? MarketClock.GetSession(b.Time).ToString() : null,
                open = complete ? Finite(b.Open) : null, high = complete ? Finite(b.High) : null,
                low = complete ? Finite(b.Low) : null, close = Finite(b.Close), incomplete = !complete,
                volume = b.Volume >= 0 ? Finite(b.Volume) : null,
                ma = snapshot is null ? null : Finite(snapshot.Sma[i]),
                ema = snapshot is null ? null : Finite(snapshot.Ema[i]),
                bollMiddle = snapshot is null ? null : Finite(snapshot.Bollinger.Middle[i]),
                bollUpper = snapshot is null ? null : Finite(snapshot.Bollinger.Upper[i]),
                bollLower = snapshot is null ? null : Finite(snapshot.Bollinger.Lower[i]),
                macd = snapshot is null ? null : Finite(snapshot.Macd.Macd[i]),
                signal = snapshot is null ? null : Finite(snapshot.Macd.Signal[i]),
                histogram = snapshot is null ? null : Finite(snapshot.Macd.Histogram[i]),
                rsi = snapshot is null ? null : Finite(snapshot.Rsi[i]),
                k = snapshot is null ? null : Finite(snapshot.Kdj.K[i]),
                d = snapshot is null ? null : Finite(snapshot.Kdj.D[i]),
                j = snapshot is null ? null : Finite(snapshot.Kdj.J[i]),
            };
        }).ToArray();
        var compare = vm.CompareLine is { } line ? line.Time.Select((t, i) => new { time = t.ToUnixTimeSeconds(), value = Finite(line.Close[i]) }).ToArray() : [];
        var loc = LocalizationService.Current;
        var studies = ChartStudyCatalog.All.Select(study =>
        {
            var available = ChartStudyCatalog.Available(study, vm);
            var enabled = vm.StudyEnabled(study.Id) && available;
            ChartStudyLine[] lines = [];
            if (enabled && study.Id == "iv")
                lines = vm.RecordedIv is { } iv ? [iv] : [];
            else if (enabled && snapshot is not null && !ChartStudyCatalog.IsBuiltIn(study.Id))
            {
                var cached = StudyCache.GetOrCreateValue(snapshot);
                if (!cached.TryGetValue(study.Id, out lines!))
                    cached[study.Id] = lines = ChartStudyCatalog.Compute(study.Id, snapshot, vm.IncompleteBars);
            }
            return new { study.Id, label = ChartStudyCatalog.Label(study, loc), study.Overlay, available, enabled,
                lines = lines.Select(line => new { line.Label, line.Style, values = indices.Select(i => Finite(line.Values[i])) }) };
        }).ToArray();
        return JsonSerializer.Serialize(new
        {
            schemaVersion = 1, key = vm.ChartKey,
            symbol = vm.Series?.Symbol ?? vm.SymbolText, preserveView = vm.PreserveView,
            language = LocalizationService.Current.Language, intraday = vm.Series?.Interval.IsIntraday() ?? false,
            events = ChartEventAlignment.Map(vm), timelineStatus = vm.Timeline is not null && vm.Timeline.Symbol == vm.Series?.Symbol ? vm.Timeline.Status : "loading",
            coverage = vm.Timeline is not null && vm.Timeline.Symbol == vm.Series?.Symbol ? vm.Timeline.Coverage : null,
            sidebarWidth = vm.RightSidebarWidth,
            rows, studies, compare, compareLabel = vm.CompareLabel,
            show = new { ma = vm.ShowMa, ema = vm.ShowEma, boll = vm.ShowBoll, volume = vm.ShowVolume, macd = vm.ShowMacd, rsi = vm.ShowRsi, kdj = vm.ShowKdj },
            labels = new { ma = vm.MaLabel, ema = vm.EmaLabel, boll = vm.BollLabel, macd = vm.MacdLabel, rsi = vm.RsiLabel, kdj = vm.KdjLabel, volume = LocalizationService.Current["Ch_Volume"], empty = LocalizationService.Current["Ch_Empty"] },
            theme = Theme(palette),
            drawingMode = vm.DrawMode?.ToString(), drawingRevision = vm.DrawingRevision, drawingEpoch = vm.DrawingEpoch,
            drawingStart = vm.DrawingStart is { } start ? new { time = start.Time.ToUnixTimeSeconds(), price = start.Price } : null,
            drawingTarget = vm.DrawingTarget is { } target ? new { time = target.Time.ToUnixTimeSeconds(), price = target.Price } : null,
            drawings = vm.Drawings.Where(d => double.IsFinite(d.Price1) && double.IsFinite(d.Price2)).Select(d => new { kind = d.Kind.ToString(), price1 = d.Price1, time1 = d.Time1?.ToUnixTimeSeconds(), price2 = d.Price2, time2 = d.Time2?.ToUnixTimeSeconds(), stopPrice = d.StopPrice }),
        }, Json);
    }
    public static object Theme(ChartPalette palette)
    {
        static string Css(ScottPlot.Color c) => $"#{c.R:X2}{c.G:X2}{c.B:X2}";
        var theme=Meili.Automation.Modules.AppThemeDefaults.Create(palette.Dark,DesignMotion.Reduced);
        theme["background"]=Css(palette.Background);theme["text"]=Css(palette.Text);theme["muted"]=Css(palette.Muted);
        theme["grid"]=$"{Css(palette.Grid)}{palette.Grid.A:X2}";theme["up"]=Css(palette.Up);theme["down"]=Css(palette.Down);
        theme["healthy"]=$"#{((palette.Dark?ThemePalette.Dark:ThemePalette.Light).Healthy&0xFFFFFF):X6}";
        theme["colors"]=JsonSerializer.SerializeToNode(new[]{palette.Series1,palette.Series2,palette.Series3,palette.Series4,palette.Series5,palette.Series6}.Select(Css));
        var ui = ThemePalette.For(palette.Dark);
        theme["textScale"] = DesignTypography.Scale;
        theme["profit"] = $"#{ui.Down & 0xFFFFFF:X6}";
        theme["loss"] = $"#{ui.Up & 0xFFFFFF:X6}";
        return theme;
    }

}
