namespace Meili.Analytics;

/// <summary>Additional chart studies, each aligned to the supplied observations.</summary>
public static class ChartStudies
{
    public static double[] Bbi(double[] close) =>
        Combine([3, 6, 12, 24], period => Indicators.Sma(close, period));

    public static double[][] Keltner(double[] high, double[] low, double[] close)
    {
        var center = Indicators.Ema(close, 20);
        var atr = Indicators.Atr(high, low, close, 10);
        return
        [
            center,
            center.Select((price, i) => price + 2 * atr[i]).ToArray(),
            center.Select((price, i) => price - 2 * atr[i]).ToArray()
        ];
    }

    public static double[][] Ichimoku(double[] high, double[] low, double[] close)
    {
        var conversion = Midpoint(9);
        var baseLine = Midpoint(26);
        var leading = conversion.Select((price, i) => (price + baseLine[i]) / 2).ToArray();
        return [conversion, baseLine, Shift(leading, 26), Shift(Midpoint(52), 26), Shift(close, -26)];

        double[] Midpoint(int period)
        {
            var upper = Indicators.Highest(high, period);
            var lower = Indicators.Lowest(low, period);
            return upper.Select((price, index) => (price + lower[index]) / 2).ToArray();
        }
    }

    public static double[] Sar(double[] high, double[] low)
    {
        var sar = Missing(high.Length);
        var run = 0;
        var rising = false;
        double extreme = 0, acceleration = .02;
        for (var i = 0; i < high.Length; i++)
        {
            if (!double.IsFinite(high[i]) || !double.IsFinite(low[i]))
            {
                run = 0;
                continue;
            }
            run++;
            if (run < 2) continue;
            if (run == 2)
            {
                rising = high[i] + low[i] >= high[i - 1] + low[i - 1];
                extreme = rising ? Math.Max(high[i], high[i - 1]) : Math.Min(low[i], low[i - 1]);
                sar[i] = rising ? Math.Min(low[i], low[i - 1]) : Math.Max(high[i], high[i - 1]);
                acceleration = .02;
                continue;
            }
            var value = sar[i - 1] + acceleration * (extreme - sar[i - 1]);
            value = rising ? Math.Min(value, Math.Min(low[i - 1], low[i - 2])) : Math.Max(value, Math.Max(high[i - 1], high[i - 2]));
            if (rising ? low[i] < value : high[i] > value)
            {
                sar[i] = rising ? Math.Max(extreme, high[i]) : Math.Min(extreme, low[i]);
                rising = !rising;
                extreme = rising ? high[i] : low[i];
                acceleration = .02;
                continue;
            }
            sar[i] = value;
            var candidate = rising ? high[i] : low[i];
            if (rising ? candidate <= extreme : candidate >= extreme) continue;
            extreme = candidate;
            acceleration = Math.Min(.2, acceleration + .02);
        }
        return sar;
    }

    /// <summary>Nine consecutive closes above/below the close four bars earlier. A completed setup starts a new run.</summary>
    public static double[] SetupCount(double[] close)
    {
        var values = Missing(close.Length);
        var count = 0;
        for (var index = 4; index < close.Length; index++)
        {
            var move = close[index] - close[index - 4];
            var direction = double.IsFinite(move) ? Math.Sign(move) : 0;
            count = direction == Math.Sign(count) && Math.Abs(count) < 9 ? count + direction : direction;
            if (count != 0) values[index] = count;
        }
        return values;
    }

    public static double[][] Arbr(double[] open, double[] high, double[] low, double[] close) =>
        [Pressure(high, low, open, clamp: false), Pressure(high, low, Shift(close, 1), clamp: true)];

    public static double[][] Cr(double[] high, double[] low, double[] close)
    {
        var typical = high.Select((value, index) => (value + low[index] + close[index]) / 3).ToArray();
        var cr = Pressure(high, low, Shift(typical, 1), clamp: true);
        return [cr, Indicators.Sma(cr, 10), Indicators.Sma(cr, 20)];
    }

    public static double[][] Dma(double[] close)
    {
        var slow = Indicators.Sma(close, 50);
        var difference = Indicators.Sma(close, 10).Select((fast, index) => fast - slow[index]).ToArray();
        return [difference, Indicators.Sma(difference, 10)];
    }

    public static double[][] Emv(double[] high, double[] low, double[] volume)
    {
        var raw = Missing(high.Length);
        for (var index = 1; index < high.Length; index++)
        {
            if (!double.IsFinite(volume[index]) || volume[index] <= 0) continue;
            var midpointMove = ((high[index] + low[index]) - (high[index - 1] + low[index - 1])) / 2;
            raw[index] = midpointMove * (high[index] - low[index]) / (volume[index] / 100_000_000);
        }
        var emv = Indicators.Sma(raw, 14);
        return [emv, Indicators.Sma(emv, 9)];
    }

    private static double[] Pressure(double[] high, double[] low, double[] reference, bool clamp)
    {
        var above = new double[high.Length];
        var below = new double[high.Length];
        for (var index = 0; index < high.Length; index++)
        {
            var rise = high[index] - reference[index];
            var fall = reference[index] - low[index];
            above[index] = clamp ? Math.Max(0, rise) : rise;
            below[index] = clamp ? Math.Max(0, fall) : fall;
        }
        var denominator = Indicators.Sma(below, 26);
        return Indicators.Sma(above, 26).Select((value, index) => denominator[index] > 0 ? 100 * value / denominator[index] : double.NaN).ToArray();
    }

    private static double[] Combine(int[] periods, Func<int, double[]> compute)
    {
        var lines = periods.Select(compute).ToArray();
        return lines[0].Select((_, index) => lines.Average(line => line[index])).ToArray();
    }

    private static double[] Shift(double[] values, int offset)
    {
        var result = Missing(values.Length);
        for (var index = Math.Max(0, -offset); index < Math.Min(values.Length, values.Length - offset); index++)
            result[index + offset] = values[index];
        return result;
    }

    private static double[] Missing(int length)
    {
        var values = new double[length];
        Array.Fill(values, double.NaN);
        return values;
    }
}
