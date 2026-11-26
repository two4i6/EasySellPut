using Meili.Analytics;
using Meili.Core.Models;
using Meili.Shared.ViewModels;

namespace Meili.Shared.Services;

public sealed record ChartStudy(string Id, string Label, bool Overlay, bool IntradayOnly = false);
public sealed record ChartStudyLine(string Label, double[] Values, string Style = "line");

public static class ChartStudyCatalog
{
    public static IReadOnlyList<ChartStudy> All { get; } =
    [
        new("bbi", "BBI", true), new("ma", "MA", true), new("mabundle", "MA group", true), new("boll", "BOLL", true), new("ema", "EMA", true),
        new("sar", "SAR", true), new("kc", "KC", true), new("ichimoku", "Ichimoku", true),
        new("vwap", "VWAP", true, IntradayOnly: true), new("setup9", "Setup 9", true),
        new("volume", "Volume", false), new("mavol", "MAVOL", false), new("macd", "MACD", false),
        new("kdj", "KDJ", false), new("arbr", "ARBR", false), new("cr", "CR", false),
        new("dma", "DMA", false), new("emv", "EMV", false), new("rsi", "RSI", false), new("iv", "IV", false),
    ];

    public static bool IsBuiltIn(string id) => id is "ma" or "ema" or "boll" or "volume" or "macd" or "kdj" or "rsi";

    public static bool Available(ChartStudy study, ChartsViewModel vm) => study.Id switch
    {
        "iv" => vm.HasIvStore && vm.Series?.Interval == BarInterval.Day1,
        _ => !study.IntradayOnly || vm.Series?.Interval.IsIntraday() == true,
    };

    public static string Label(ChartStudy study, LocalizationService loc) => study.Id switch
    {
        "volume" => loc["Ch_Volume"],
        "mabundle" => loc["Ch_StudyMaGroup"],
        "ichimoku" => loc["Ch_StudyIchimoku"],
        "setup9" => loc["Ch_StudySetup9"],
        _ => study.Label,
    };

    public static ChartStudyLine[] Compute(string id, KlineSnapshot snapshot, IReadOnlyList<bool> incomplete)
    {
        var b = snapshot.Columns;
        var high = Mask(b.High);
        var low = Mask(b.Low);
        return id switch
        {
            "bbi" => [new("BBI", ChartStudies.Bbi(b.Close))],
            "mabundle" => new[] { 5, 10, 20, 30, 60, 120, 250, 500, 1000 }
                .Select(period => new ChartStudyLine($"MA{period}", Indicators.Sma(b.Close, period))).ToArray(),
            "sar" => [new("SAR", ChartStudies.Sar(high, low), "dots")],
            "kc" => Lines(ChartStudies.Keltner(high, low, b.Close), ["KC", "KC ↑", "KC ↓"]),
            "ichimoku" => Lines(ChartStudies.Ichimoku(high, low, b.Close), ["Tenkan", "Kijun", "Senkou A", "Senkou B", "Chikou"]),
            "vwap" => [new("VWAP", Mask(Indicators.Vwap(b.Time, high, low, b.Close, b.Volume)))],
            "setup9" => [new("9", ChartStudies.SetupCount(b.Close), "counts")],
            "mavol" => [new("VOL", b.Volume, "volume"), .. new[] { 5, 10, 20 }
                .Select(period => new ChartStudyLine($"MAVOL{period}", Indicators.Sma(b.Volume, period)))],
            "arbr" => Lines(ChartStudies.Arbr(Mask(b.Open), high, low, b.Close), ["AR", "BR"]),
            "cr" => Lines(ChartStudies.Cr(high, low, b.Close), ["CR", "CR MA10", "CR MA20"]),
            "dma" => Lines(ChartStudies.Dma(b.Close), ["DIF", "DMA"]),
            "emv" => Lines(ChartStudies.Emv(high, low, b.Volume), ["EMV", "MAEMV"]),
            _ => [],
        };

        double[] Mask(double[] values) => values.Select((value, i) =>
            i < incomplete.Count && incomplete[i] ? double.NaN : value).ToArray();
    }

    private static ChartStudyLine[] Lines(double[][] values, string[] names) =>
        values.Select((line, i) => new ChartStudyLine(names[i], line)).ToArray();
}
