using Meili.Shared.ViewModels;
namespace Meili.Shared.Tests;
public sealed class FinancialChartTests
{
    [Fact] public void Signed_columns_share_one_zero_scale_and_keep_missing_actuals_distinct_from_zero()
    {
        var chart=FinancialChart.Build("EPS","fixture",new (string,string,double?,double?)[]{("old","loss",-2,1),("now","zero",0,null),("future","forecast",null,4),("invalid","unknown",double.NaN,double.PositiveInfinity)});
        var a=chart.Points[0];Assert.Equal(40,a.ActualNegative);Assert.Equal(0,a.ActualPositive);Assert.Equal(20,a.EstimatePositive);
        Assert.Equal(80,chart.Points[2].EstimatePositive);Assert.Null(chart.Points[2].Actual);Assert.Equal("—",chart.Points[2].ActualText);
        Assert.Equal(0,chart.Points[1].Actual);Assert.NotEqual("—",chart.Points[1].ActualText);
        Assert.Null(chart.Points[3].Actual);Assert.Null(chart.Points[3].Estimate);Assert.All(chart.Points,p=>Assert.Equal(80,p.NegativeSpace));
        Assert.False(FinancialChart.Build("empty","",[]).HasData);
    }
}
