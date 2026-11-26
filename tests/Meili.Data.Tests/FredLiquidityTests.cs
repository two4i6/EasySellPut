using Meili.Core.Models;
using System.Net;
using Meili.Data.Http;
using Meili.Data.Providers.Fred;
namespace Meili.Data.Tests;
public sealed class FredLiquidityTests
{
    [Fact]public void Csv_missing_values_stay_missing_and_bad_payloads_are_rejected()
    {
        var fetched=new DateTimeOffset(2026,11,13,18,0,0,TimeSpan.Zero);
        var series=FredLiquidityProvider.Parse("SOFR","observation_date,SOFR\r\n2026-11-10,4.01\r\n2026-11-11,.\r\n2026-11-12,\r\n2026-11-13,4.0\r\n2026-11-14,5\r\n",fetched);
        Assert.Equal(2,series.Observations.Count);Assert.Equal(fetched,series.FetchedAt);Assert.Equal("percent",series.Unit);
        Assert.Throws<FormatException>(()=>FredLiquidityProvider.Parse("SOFR","<html>blocked</html>",fetched));
        Assert.Throws<FormatException>(()=>FredLiquidityProvider.Parse("SOFR","observation_date,SOFR\n2026-11-12,NaN",fetched));
        Assert.Throws<ArgumentException>(()=>FredLiquidityProvider.Parse("OTHER","",fetched));
    }
    [Fact]public async Task Uses_allowlisted_csv_and_shared_response_cache_without_replacing_observation_dates()
    {
        var handler=new FakeHandler().Enqueue(HttpStatusCode.OK,"observation_date,SOFR\n2026-11-12,4.0\n");
        using var gateway=TestHttp.Gateway(handler);var cache=new ResponseCache();var provider=new FredLiquidityProvider(gateway,cache);provider.RegisterRateLimit();
        var a=await provider.GetSeriesAsync("SOFR");var b=await provider.GetSeriesAsync("SOFR");Assert.Same(a,b);Assert.Single(handler.Requests);
        Assert.Equal("fred.stlouisfed.org",handler.Requests[0].RequestUri!.Host);Assert.Equal(new DateOnly(2026,11,12),a.Observations[0].Date);
        await Assert.ThrowsAsync<ArgumentException>(async()=>await provider.GetSeriesAsync("https://example.com"));
        cache.Clear();Assert.False(cache.TryGet<LiquiditySeries>("fred:liquidity:SOFR",out _));
    }
    [Fact]public async Task Connectivity_probe_bypasses_cached_observations_and_records_actual_network_failure()
    {
        var handler=new FakeHandler().Enqueue(HttpStatusCode.OK,"observation_date,SOFR\n2026-11-12,4.0\n").Enqueue(HttpStatusCode.ServiceUnavailable,"offline");
        using var gateway=TestHttp.Gateway(handler,retries:0);var provider=new FredLiquidityProvider(gateway,new ResponseCache());provider.RegisterRateLimit();
        await provider.GetSeriesAsync("SOFR");
        var health=new Meili.Data.Routing.HealthTracker();var router=new Meili.Data.Routing.FailoverRouter([provider],health,Meili.Data.DataServices.DefaultOrder);
        await router.ProbeAsync(provider);Assert.Equal(2,handler.Requests.Count);
        Assert.Equal(Meili.Data.Routing.HealthState.Down,health.Get("fred")!.State(health.Now));
    }
    [Fact]public async Task Transient_failure_retries_but_blocked_response_is_not_cached_or_retried()
    {
        var transient=new FakeHandler().Enqueue(HttpStatusCode.ServiceUnavailable,"busy").Enqueue(HttpStatusCode.OK,"observation_date,SOFR\n2026-11-12,4.0\n");
        using(var http=TestHttp.Gateway(transient))
        {
            var provider=new FredLiquidityProvider(http,new ResponseCache());
            Assert.Single((await provider.GetSeriesAsync("SOFR")).Observations);Assert.Equal(2,transient.Requests.Count);
        }
        var blocked=new FakeHandler().Enqueue(HttpStatusCode.Forbidden,"blocked").Enqueue(HttpStatusCode.OK,"observation_date,SOFR\n2026-11-12,4.0\n");
        using(var http=TestHttp.Gateway(blocked))
        {
            var provider=new FredLiquidityProvider(http,new ResponseCache());
            var error=await Assert.ThrowsAsync<DataSourceException>(()=>provider.GetSeriesAsync("SOFR"));
            Assert.Equal(403,error.StatusCode);Assert.Single(blocked.Requests);
            Assert.Single((await provider.GetSeriesAsync("SOFR")).Observations);Assert.Equal(2,blocked.Requests.Count);
        }
    }

    [Fact]public async Task Empty_valid_csv_is_not_cached_as_a_successful_series()
    {
        var handler=new FakeHandler().Enqueue(HttpStatusCode.OK,"observation_date,SOFR\n2026-11-12,.\n").Enqueue(HttpStatusCode.OK,"observation_date,SOFR\n2026-11-12,4.0\n");
        using var http=TestHttp.Gateway(handler);var provider=new FredLiquidityProvider(http,new ResponseCache());
        var error=await Assert.ThrowsAsync<DataSourceException>(()=>provider.GetSeriesAsync("SOFR"));Assert.Equal(DataErrorKind.NoData,error.Kind);
        Assert.Single((await provider.GetSeriesAsync("SOFR")).Observations);Assert.Equal(2,handler.Requests.Count);
    }

}
