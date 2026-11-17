using System.Text.Json;
using Meili.Automation;
using Meili.Core.Models;
namespace Meili.Automation.Tests;
public sealed class QqqGexCaptureTests
{
    [Fact] public async Task Missing_provider_timestamp_is_partial_and_never_replaced_by_download_time()
    {
        var dir=Path.Combine(Path.GetTempPath(),Guid.NewGuid().ToString("N"));var result=await new QqqGexCaptureService(new FakeMarket(),dir).CaptureAsync();using var output=JsonSerializer.SerializeToDocument(result);
        Assert.False(output.RootElement.GetProperty("complete").GetBoolean());Assert.Equal(0,output.RootElement.GetProperty("capturedExpiries").GetInt32());
        using var input=JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(dir,"cache","qqq-gex-input.json")));Assert.Empty(input.RootElement.GetProperty("captures").EnumerateArray());Assert.Single(input.RootElement.GetProperty("missingExpiries").EnumerateArray());
    }
    [Fact] public async Task Valid_chain_preserves_zero_bid_missing_oi_delay_and_authoritative_valuation_time()
    {
        var at=DateTimeOffset.Parse("2026-11-13T15:00:00Z");var expiry=new DateOnly(2027,6,18);var dir=Path.Combine(Path.GetTempPath(),Guid.NewGuid().ToString("N"));
        var chain=new OptionChain{Underlying="QQQ",Source="fixture",AsOf=at,UnderlyingLastTradeAt=at.AddDays(-1),FetchedAt=at.AddMinutes(15),DelayMinutes=15,UnderlyingPrice=600,Expirations=[expiry],Contracts=[new(){Underlying="QQQ",ContractSymbol="c",Right=OptionRight.Call,Strike=600,Expiration=expiry,Bid=0,Ask=1,ImpliedVolatility=.2},new(){Underlying="QQQ",ContractSymbol="p",Right=OptionRight.Put,Strike=600,Expiration=expiry,OpenInterest=0}]};
        await new QqqGexCaptureService(new FakeMarket{ChainOverride=chain},dir).CaptureAsync();using var input=JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(dir,"cache","qqq-gex-input.json")));
        var c=input.RootElement.GetProperty("captures")[0];Assert.Equal(at,DateTimeOffset.Parse(c.GetProperty("valuationAt").GetString()!));var call=c.GetProperty("result").GetProperty("options")[0].GetProperty("calls")[0];Assert.Equal(0,call.GetProperty("bid").GetDouble());Assert.Equal(JsonValueKind.Null,call.GetProperty("openInterest").ValueKind);Assert.Empty(input.RootElement.GetProperty("bars").EnumerateArray());Assert.Equal(15,input.RootElement.GetProperty("provenance")[0].GetProperty("DelayMinutes").GetInt32());Assert.Equal(at.AddDays(-1),DateTimeOffset.Parse(input.RootElement.GetProperty("marketInputs").GetProperty("underlyingLastTradeAt").GetString()!));Assert.True(input.RootElement.GetProperty("marketInputs").GetProperty("delayed").GetBoolean());var daily=input.RootElement.GetProperty("marketInputs").GetProperty("daily");foreach(var symbol in new[]{"QQQ","^VIX","^VIX3M","^VXN","^GSPC","^TNX","^IRX","CL=F","GC=F","DX-Y.NYB","SPY"})Assert.True(daily.TryGetProperty(symbol,out _));Assert.Equal("AAPL",input.RootElement.GetProperty("marketInputs").GetProperty("macro").GetProperty("quotes")[0].GetProperty("Symbol").GetString());
    }
    [Fact] public async Task Context_deadline_retains_observed_chain_and_caller_cancellation_does_not_report_success()
    {
        var at=DateTimeOffset.UtcNow;var expiry=new DateOnly(2027,6,18);var dir=Path.Combine(Path.GetTempPath(),Guid.NewGuid().ToString("N"));
        var chain=new OptionChain{Underlying="QQQ",Source="fixture",AsOf=at,FetchedAt=at,UnderlyingPrice=600,Expirations=[expiry],Contracts=[new(){Underlying="QQQ",ContractSymbol="c",Right=OptionRight.Call,Strike=600,Expiration=expiry,OpenInterest=0},new(){Underlying="QQQ",ContractSymbol="p",Right=OptionRight.Put,Strike=600,Expiration=expiry,OpenInterest=0}]};
        var market=new FakeMarket{ChainOverride=chain,BarsOverride=async(request,token)=>{if(request.Interval==BarInterval.Day1)await Task.Delay(Timeout.InfiniteTimeSpan,token);return new BarSeries{Symbol=request.Symbol,Interval=request.Interval,Source="fixture",Bars=[]};}};
        var result=await new QqqGexCaptureService(market,dir,TimeSpan.FromSeconds(5)).CaptureAsync();using var doc=JsonSerializer.SerializeToDocument(result);Assert.Equal(1,doc.RootElement.GetProperty("capturedExpiries").GetInt32());Assert.False(doc.RootElement.GetProperty("complete").GetBoolean());Assert.True(new Meili.Data.Cache.QqqGexResponseStore(Path.Combine(dir,"cache","qqq-gex.db")).HasObservedInput());
        using var cancelled=new CancellationTokenSource();cancelled.Cancel();await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>new QqqGexCaptureService(market,Path.Combine(dir,"cancelled")).CaptureAsync(cancelled.Token));Assert.False(File.Exists(Path.Combine(dir,"cancelled","cache","qqq-gex-input.json")));
    }
    [Theory]
    [InlineData(15, true)]
    [InlineData(180, false)]
    public async Task Cboe_reported_event_bounds_price_buckets_and_preserves_publication(int lagMinutes,bool aligned)
    {
        var publication=DateTimeOffset.Parse("2026-11-16T15:17:00Z");var eventAt=publication.AddMinutes(-lagMinutes);var expiry=new DateOnly(2027,6,18);
        var chain=new OptionChain{Underlying="QQQ",Source="cboe",AsOf=publication,UnderlyingLastTradeAt=eventAt,FetchedAt=publication.AddSeconds(10),DelayMinutes=15,UnderlyingPrice=600,Expirations=[expiry],Contracts=[new(){Underlying="QQQ",ContractSymbol="c",Right=OptionRight.Call,Strike=600,Expiration=expiry,OpenInterest=100,ImpliedVolatility=.2},new(){Underlying="QQQ",ContractSymbol="p",Right=OptionRight.Put,Strike=600,Expiration=expiry,OpenInterest=100}]};
        BarRequest? intraday=null;
        var market=new FakeMarket{ChainOverride=chain,BarsOverride=(request,ct)=>{
            if(request.Interval!=BarInterval.Minute1)return Task.FromResult(new BarSeries{Symbol=request.Symbol,Interval=request.Interval,Source="fixture",Bars=[]});
            intraday=request;return Task.FromResult(new BarSeries{Symbol="QQQ",Interval=BarInterval.Minute1,Source="fixture",Bars=Enumerable.Range(0,6).Select(i=>new Bar(DateTimeOffset.Parse("2026-11-16T15:00:00Z").AddMinutes(i),600,601,599,600,100)).ToArray()});}};
        var dir=Path.Combine(Path.GetTempPath(),Guid.NewGuid().ToString("N"));await new QqqGexCaptureService(market,dir).CaptureAsync();
        using var doc=JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(dir,"cache","qqq-gex-input.json")));var input=doc.RootElement;var capture=input.GetProperty("captures")[0];
        Assert.Equal(publication,DateTimeOffset.Parse(capture.GetProperty("sourcePublicationAt").GetString()!));Assert.Equal(aligned,input.GetProperty("quality").GetProperty("sourceTimeAligned").GetBoolean());
        Assert.Equal(aligned?eventAt:publication,DateTimeOffset.Parse(capture.GetProperty("valuationAt").GetString()!));Assert.True(input.GetProperty("marketInputs").GetProperty("delayed").GetBoolean());
        Assert.Equal(1,input.GetProperty("quality").GetProperty("missingIv").GetInt32());Assert.False(input.GetProperty("providerCoverageComplete").GetBoolean());
        if(aligned){Assert.Single(input.GetProperty("bars").EnumerateArray());Assert.Equal(eventAt,DateTimeOffset.Parse(input.GetProperty("barMetadata").GetProperty("priceCutoff").GetString()!));}
    }
    [Fact] public async Task Current_stock_display_does_not_extend_delayed_GEX_valuation_bars()
    {
        var eventAt=DateTimeOffset.Parse("2026-11-16T15:02:00Z");var publication=eventAt.AddMinutes(15);var expiry=new DateOnly(2027,6,18);BarRequest? requested=null;
        var chain=new OptionChain{Underlying="QQQ",Source="cboe",AsOf=publication,UnderlyingLastTradeAt=eventAt,FetchedAt=publication.AddSeconds(1),DelayMinutes=15,UnderlyingPrice=600,Expirations=[expiry],Contracts=[new(){Underlying="QQQ",ContractSymbol="c",Right=OptionRight.Call,Strike=600,Expiration=expiry,OpenInterest=100,ImpliedVolatility=.2},new(){Underlying="QQQ",ContractSymbol="p",Right=OptionRight.Put,Strike=600,Expiration=expiry,OpenInterest=100,ImpliedVolatility=.2}]};
        var recent=Enumerable.Range(0,18).Select(i=>new Bar(eventAt.AddMinutes(i-2),600+i,601+i,599+i,600+i,100)).ToArray();
        var market=new FakeMarket{ChainOverride=chain,BarsOverride=(r,ct)=>{requested=r;return Task.FromResult(new BarSeries{Symbol="QQQ",Interval=r.Interval,Source="stock-fixture",AsOf=publication,Bars=recent});}};
        var dir=Path.Combine(Path.GetTempPath(),Guid.NewGuid().ToString("N"));await new QqqGexCaptureService(market,dir).CaptureAsync(includeContext:false);
        using var doc=JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(dir,"cache","qqq-gex-input.json")));var value=doc.RootElement;
        Assert.True(requested!.To>publication);Assert.Single(value.GetProperty("bars").EnumerateArray());Assert.Equal(9,value.GetProperty("displayPrices").GetProperty("bars").GetArrayLength());
        Assert.Equal(eventAt,DateTimeOffset.Parse(value.GetProperty("barMetadata").GetProperty("priceCutoff").GetString()!));Assert.Equal(eventAt,DateTimeOffset.Parse(value.GetProperty("captures")[0].GetProperty("valuationAt").GetString()!));
        Assert.Equal(601,value.GetProperty("bars")[0].GetProperty("close").GetDouble());Assert.Equal(617,value.GetProperty("displayPrices").GetProperty("bars")[8].GetProperty("close").GetDouble());Assert.False(value.GetProperty("complete").GetBoolean());
        // The same stock provider remains current for ordinary charts; only the model prefix is delayed.
        var ordinary=await market.GetBarsAsync(new("QQQ",BarInterval.Minute1),default);Assert.Equal(ordinary.Bars.Last().Close,value.GetProperty("displayPrices").GetProperty("bars")[8].GetProperty("close").GetDouble());
    }
    [Fact] public async Task Core_bootstrap_defers_daily_and_macro_context_without_claiming_full_coverage()
    {
        var at=DateTimeOffset.Parse("2026-11-16T15:02:00Z");var expiry=new DateOnly(2027,6,18);var calls=0;var chain=new OptionChain{Underlying="QQQ",Source="fixture",AsOf=at,FetchedAt=at,UnderlyingPrice=600,Expirations=[expiry],Contracts=[new(){Underlying="QQQ",ContractSymbol="c",Right=OptionRight.Call,Strike=600,Expiration=expiry,OpenInterest=100,ImpliedVolatility=.2},new(){Underlying="QQQ",ContractSymbol="p",Right=OptionRight.Put,Strike=600,Expiration=expiry,OpenInterest=100,ImpliedVolatility=.2}]};
        var market=new FakeMarket{ChainOverride=chain,BarsOverride=(request,ct)=>{if(request.Interval==BarInterval.Day1)Interlocked.Increment(ref calls);return Task.FromResult(new BarSeries{Symbol=request.Symbol,Interval=request.Interval,Source="fixture",Bars=[]});}};var dir=Path.Combine(Path.GetTempPath(),Guid.NewGuid().ToString("N"));await new QqqGexCaptureService(market,dir).CaptureAsync(includeContext:false);using var input=JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(dir,"cache","qqq-gex-input.json")));Assert.Equal(0,calls);Assert.True(input.RootElement.GetProperty("marketInputs").GetProperty("contextDeferred").GetBoolean());Assert.Empty(input.RootElement.GetProperty("marketInputs").GetProperty("macro").GetProperty("quotes").EnumerateArray());Assert.False(input.RootElement.GetProperty("complete").GetBoolean());Assert.Single(input.RootElement.GetProperty("captures").EnumerateArray());
    }
}
