using System.Text;
using Meili.Automation.Tests;
using Meili.Core.Models;

internal static class GexCaptureFixture
{
    internal static FakeMarket Market(string mode="aligned")
    {
        var at=DateTimeOffset.Parse("2026-11-13T15:00:00Z");var expiry=new DateOnly(2027,6,18);
        var baseChain=new OptionChain
        {
            Underlying="QQQ",UnderlyingPrice=100,Source=mode.Contains("cboe")?"cboe":"fixture",AsOf=at,FetchedAt=at.AddSeconds(1),UnderlyingLastTradeAt=mode=="delayed-cboe"?at.AddMinutes(-15):mode=="unverified-cboe"?at.AddMinutes(-20):mode=="boundary-cboe"?at.AddMinutes(-17).AddTicks(-1):at,DelayMinutes=mode.Contains("cboe")?15:0,IsRealtime=!mode.Contains("cboe"),Expirations=[expiry],Expiration=expiry,
            RawSourcePayload=Encoding.UTF8.GetBytes("{\"provider\":\"synthetic test source\",\"body\":\"原始字节\"}"),
            Contracts=mode=="large"?Enumerable.Range(1,10000).SelectMany(strike=>new[]{Contract(OptionRight.Call) with{Strike=strike},Contract(OptionRight.Put) with{Strike=strike}}).ToArray():[Contract(OptionRight.Call) with{ImpliedVolatility=mode=="missing-iv"?null:.2},Contract(OptionRight.Put)]
        };
        return new FakeMarket
        {
            ChainOverride=baseChain,
            ExpirationsFactory=mode=="source-fail"?()=>throw new Meili.Data.Http.DataSourceException("fixture",Meili.Data.Http.DataErrorKind.NoData,"Synthetic source unavailable"):null,
            ExpirationsOverride=mode is "partial" or "changed-raw"?[expiry,expiry.AddDays(7)]:null,
            ChainFactory=mode is "partial" or "changed-raw"?requested=>requested==expiry?baseChain:mode=="partial"?throw new HttpRequestException("Synthetic source failure"):baseChain with{Contracts=baseChain.Contracts.Select(contract=>contract with{Expiration=expiry.AddDays(7)}).ToArray(),RawSourcePayload=Encoding.UTF8.GetBytes("changed revision fixture")}:null,
            BarsOverride=(request,ct)=>Task.FromResult(new BarSeries
            {
                Symbol=request.Symbol,Interval=request.Interval,Source="fixture",AsOf=at,FetchedAt=at.AddSeconds(2),DelayMinutes=0,IsRealtime=true,Adjustment=PriceAdjustment.Split,
                Bars=request.Interval==BarInterval.Minute1?Enumerable.Range(0,8).Select(i=>new Bar(at.AddMinutes(-10+i),100,101,99,100,100+i)).ToArray():[new(at.AddDays(-3),100,101,99,100,500),new(at.AddDays(-2),100,101,99,100,600)]
            })
        };
        OptionContract Contract(OptionRight right)=>new(){Underlying="QQQ",ContractSymbol=right.ToString(),Right=right,Expiration=expiry,Strike=100,ImpliedVolatility=.2,OpenInterest=100,Bid=1,Ask=2,Last=1.5,Volume=20,LastTradeTime=at,InTheMoney=false};
    }
}
