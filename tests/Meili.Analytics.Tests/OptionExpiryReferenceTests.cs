namespace Meili.Analytics.Tests;

public sealed class OptionExpiryReferenceTests
{
    [Theory]
    [InlineData(OptionRight.Call, 4, 104, .04)]
    [InlineData(OptionRight.Put, 4, 96, -.04)]
    [InlineData(OptionRight.Put, 100, 0, -1)]
    public void Uses_single_long_expiry_payoff_and_signed_snapshot_distance(OptionRight right, double ask, double be, double distance)
    {
        var value = OptionExpiryReference.ForLong(right, 100, new(2027, 1, 15), ask, 100);
        Assert.Equal(be, value.BreakEven!.Value, 9);
        Assert.Equal(distance, value.DistanceToBreakEven!.Value, 9);
    }
    [Fact]
    public void Unreachable_put_breakeven_and_missing_observed_quote_are_not_fabricated()
    {
        Assert.Null(OptionExpiryReference.ForLong(OptionRight.Put, 100, new(2027, 1, 15), 101, 100).BreakEven);
        foreach (var premium in new double?[] { null, 0, -1, double.NaN, double.PositiveInfinity })
            Assert.Null(OptionExpiryReference.ForLong(OptionRight.Call, 100, new(2027, 1, 15), premium, 100).BreakEven);
        var unknownSpot = OptionExpiryReference.ForLong(OptionRight.Call, 100, new(2027, 1, 15), 4, null);
        Assert.Equal(104, unknownSpot.BreakEven); Assert.Null(unknownSpot.DistanceToBreakEven);
    }
}
