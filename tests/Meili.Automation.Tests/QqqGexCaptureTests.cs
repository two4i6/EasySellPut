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
        var c=input.RootElement.GetProperty("captures")[0];Assert.Equal(at,DateTimeOffset.Parse(c.GetProperty("valuationAt").GetString()!));var call=c.GetProperty("result").GetProperty("options")[0].GetProperty("calls")[0];Assert.Equal(0,call.GetProperty("bid").GetDouble());Assert.Equal(JsonValueKind.Null,call.GetProperty("openInterest").ValueKind);Assert.Empty(input.RootElement.GetProperty("bars").EnumerateArray());Assert.Equal(15,input.RootElement.GetProperty("provenance")[0].GetProperty("DelayMinutes").GetInt32());Assert.Equal(at.AddDays(-1),DateTimeOffset.Parse(input.RootElement.GetProperty("marketInputs").GetProperty("underlyingLastTradeAt").GetString()!));Assert.True(input.RootElement.GetProperty("marketInputs").GetProperty("delayed").GetBoolean());Assert.Equal(4,input.RootElement.GetProperty("marketInputs").GetProperty("daily").EnumerateObject().Count());
    }
    [Fact] public async Task Context_deadline_retains_observed_chain_and_caller_cancellation_does_not_report_success()
    {
        var at=DateTimeOffset.UtcNow;var expiry=new DateOnly(2027,6,18);var dir=Path.Combine(Path.GetTempPath(),Guid.NewGuid().ToString("N"));
        var chain=new OptionChain{Underlying="QQQ",Source="fixture",AsOf=at,FetchedAt=at,UnderlyingPrice=600,Expirations=[expiry],Contracts=[new(){Underlying="QQQ",ContractSymbol="c",Right=OptionRight.Call,Strike=600,Expiration=expiry,OpenInterest=0},new(){Underlying="QQQ",ContractSymbol="p",Right=OptionRight.Put,Strike=600,Expiration=expiry,OpenInterest=0}]};
        var market=new FakeMarket{ChainOverride=chain,BarsOverride=async(request,token)=>{if(request.Interval==BarInterval.Day1)await Task.Delay(Timeout.InfiniteTimeSpan,token);return new BarSeries{Symbol=request.Symbol,Interval=request.Interval,Source="fixture",Bars=[]};}};
        var result=await new QqqGexCaptureService(market,dir,TimeSpan.FromMilliseconds(250)).CaptureAsync();using var doc=JsonSerializer.SerializeToDocument(result);Assert.Equal(1,doc.RootElement.GetProperty("capturedExpiries").GetInt32());Assert.False(doc.RootElement.GetProperty("complete").GetBoolean());Assert.True(new Meili.Data.Cache.QqqGexResponseStore(Path.Combine(dir,"cache","qqq-gex.db")).HasObservedInput());
        using var cancelled=new CancellationTokenSource();cancelled.Cancel();await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>new QqqGexCaptureService(market,Path.Combine(dir,"cancelled")).CaptureAsync(cancelled.Token));Assert.False(File.Exists(Path.Combine(dir,"cancelled","cache","qqq-gex-input.json")));
    }
}
