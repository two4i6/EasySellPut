namespace Meili.Shared.Tests;
public sealed class GaugePlanTests
{
    [Theory][InlineData(0,12,120)][InlineData(50,120,12)][InlineData(100,228,120)]
    public void Score_runs_from_left_low_through_top_neutral_to_right_high(double value,double x,double y)
    {
        var plan=GaugePlan.Create(240,132,value);Assert.Equal(x,plan.Marker!.Value.X,6);Assert.Equal(y,plan.Marker.Value.Y,6);
        Assert.All(plan.Bands.SelectMany(b=>b),p=>{Assert.InRange(p.X,0,240);Assert.InRange(p.Y,0,132);});
    }
    [Fact]public void Missing_and_nonfinite_scores_have_no_marker()
    {Assert.Null(GaugePlan.Create(240,132,null).Marker);Assert.Null(GaugePlan.Create(240,132,double.NaN).Marker);}
}
