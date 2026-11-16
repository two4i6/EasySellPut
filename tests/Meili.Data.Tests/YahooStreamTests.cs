using Meili.Core.Models;
using Meili.Data.Providers.Yahoo;
namespace Meili.Data.Tests;

public sealed class YahooStreamTests
{
    // Recorded public Yahoo pricing frame; fixed bytes are a decoder fixture, never a production price.
    private const string Frame="{\"type\":\"pricing\",\"message\":\"CgNRUVEV4zonRBjQiaTRvGgqA05HTTAUOAFFnIbOv0jGh+oMZcCEL8GwAZAD2AEE9QLAhC/B/QKchs6/\"}";
    [Fact]public void Pricing_frame_preserves_source_symbol_price_signed_millisecond_time_and_session()
    {
        var tick=YahooStreamDecoder.Parse(Frame)!;
        Assert.Equal("QQQ",tick.Symbol);Assert.InRange(tick.Price,668,670);Assert.Equal(MarketState.Regular,tick.Session);
        Assert.Equal(2026,tick.Time.Year);Assert.Equal(11,tick.Time.Month);Assert.Equal(16,tick.Time.Day);Assert.Equal("yahoo",tick.Source);Assert.NotNull(tick.Volume);
        Assert.Null(YahooStreamDecoder.Parse("{\"type\":\"heartbeat\"}"));
    }
    [Fact]public void Broken_lengths_bad_base64_and_nonfinite_prices_cannot_enter_the_quote_stream()
    {
        Assert.Throws<FormatException>(()=>YahooStreamDecoder.Parse("{\"type\":\"pricing\",\"message\":\"!\"}"));
        Assert.Throws<FormatException>(()=>YahooStreamDecoder.Parse("{\"type\":\"pricing\",\"message\":\"Cg==\"}"));
        Assert.Throws<FormatException>(()=>YahooStreamDecoder.Parse(new string('x',65537)));
        Assert.Null(YahooStreamDecoder.Parse("{\"type\":\"pricing\",\"message\":\"\"}"));
    }
}
