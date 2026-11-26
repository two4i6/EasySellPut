using Meili.Analytics;
namespace Meili.Analytics.Tests;
public sealed class LiquidityMathTests
{
    [Fact] public void Spreads_join_exact_dates_and_convert_percentage_points_to_basis_points()
    {
        var day=new DateOnly(2026,11,12);
        var points=LiquidityMath.Spread([(day,4.01),(day.AddDays(1),4.1),(day.AddDays(2),double.NaN)],[(day,4.0),(day.AddDays(2),4.0)]);
        var point=Assert.Single(points);Assert.Equal(day,point.Date);Assert.Equal(1,point.Value,8);
    }
    [Fact] public void Activity_excludes_latest_bar_from_baseline_and_computes_impact_without_return_direction_bias()
    {
        var bars=Enumerable.Repeat((Close:100.0,Volume:1_000_000.0),20).Append((Close:110.0,Volume:2_000_000.0)).ToArray();
        var result=LiquidityMath.Activity(bars)!;Assert.Equal(220_000_000,result.DollarVolume);Assert.Equal(2.2,result.RelativeDollarVolume,8);
        Assert.Equal(10.0/220_000_000*1_000_000/20,result.AmihudPercentPerMillion,8);
        Assert.Null(LiquidityMath.Activity(bars.Take(20).ToArray()));
        Assert.Null(LiquidityMath.Activity(bars.Take(20).Append((100.0,0.0)).ToArray()));
        Assert.Null(LiquidityMath.Activity(bars.Take(20).Append((double.MaxValue,double.MaxValue)).ToArray()));
    }
    [Fact]public void Pressure_is_bounded_transparent_and_missing_numbers_never_turn_into_neutral()
    {
        var normal=LiquidityMath.Pressure(1,-2,0)!;Assert.Equal(49.8,normal.Score);Assert.Equal(52,normal.SofrScore);Assert.Equal(46,normal.EffrScore);
        Assert.Equal(100,LiquidityMath.Pressure(1000,1000,-.1)!.Score);
        Assert.Equal(0,LiquidityMath.Pressure(-1000,-1000,.1)!.Score);
        Assert.Equal(50,LiquidityMath.Pressure(0,0,0)!.Score);
        Assert.Null(LiquidityMath.Pressure(double.NaN,0,0));Assert.Null(LiquidityMath.Pressure(0,0,double.PositiveInfinity));
    }
}
