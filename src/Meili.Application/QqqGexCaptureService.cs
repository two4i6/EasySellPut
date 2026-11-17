using Meili.Core.Diagnostics;
using System.Text.Json;
using Meili.Core.Abstractions;
using Meili.Core.Models;
using Meili.Core.Settings;

namespace Meili.Automation;

/// <summary>Export routed provider inputs for the single maintained GEX calculation runtime.</summary>
public sealed class QqqGexCaptureService(IMarketDataService market,string dataDirectory,TimeSpan? captureTimeout=null)
{
    public async Task<object> CaptureAsync(CancellationToken ct=default,bool includeContext=true)
    {
        var captureBudget=captureTimeout??TimeSpan.FromSeconds(90);if(captureBudget<=TimeSpan.Zero||captureBudget>TimeSpan.FromSeconds(90))throw new ArgumentOutOfRangeException(nameof(captureTimeout));
        ct.ThrowIfCancellationRequested();
        using var execution=Meili.Automation.Modules.ModuleAccess.AcquireEnabled(dataDirectory,"easysellput.qqq-gex");
        using var job=await Meili.Automation.Modules.ModuleJobs.AcquireAsync(dataDirectory,"easysellput.qqq-gex",ct).ConfigureAwait(false);
        var callerCt=ct;using var deadline=CancellationTokenSource.CreateLinkedTokenSource(ct);deadline.CancelAfter(captureBudget);ct=deadline.Token;
        var store=new Meili.Data.Cache.QqqGexResponseStore(Path.Combine(dataDirectory,"cache","qqq-gex.db"));
        var expected=(await market.GetExpirationsAsync("QQQ",ct)).Distinct().Order().ToArray();
        if(expected.Length is 0 or >128)return new {status="source_unavailable",symbol="QQQ",complete=false,reason="Expiry index must contain 1–128 dates"};
        ReadOnlyMemory<byte> rawAnchor=default;string? rawHash=null;var missingOi=0;var missingIv=0;var allRealtime=true;var delayKnown=true;var maxDelay=0;DateTimeOffset? underlyingLastTradeAt=null;DateTimeOffset? marketAt=null;var timingVerified=true;
        var captures=new List<object>();var missing=new List<object>();var provenance=new List<object>();string? source=null;DateTimeOffset? asOf=null;double? spot=null;
        foreach(var expiry in expected)
        {
            try
            {
                ct.ThrowIfCancellationRequested();
                var chain=await market.GetChainAsync("QQQ",expiry,ct);
                if(chain.AsOf is null||chain.FetchedAt is null||chain.UnderlyingPrice is not >0||!double.IsFinite(chain.UnderlyingPrice.Value)||chain.Contracts.Count==0||chain.Contracts.Any(c=>c.Expiration!=expiry)||chain.Contracts.GroupBy(c=>(c.Right,c.Strike)).Any(g=>g.Count()>1))throw new InvalidDataException("Missing source time/spot, wrong expiry or duplicate contract");
                allRealtime&=chain.IsRealtime;delayKnown&=chain.DelayMinutes.HasValue;maxDelay=Math.Max(maxDelay,chain.DelayMinutes??0);underlyingLastTradeAt??=chain.UnderlyingLastTradeAt;
                source??=chain.Source;asOf??=chain.AsOf;spot??=chain.UnderlyingPrice;
                if(chain.Source!=source||chain.AsOf!=asOf||chain.UnderlyingPrice!=spot)throw new InvalidDataException("Source, snapshot time or underlying spot changed across expiry reads");
                var sourceMarketAt=QqqGexSourceTiming.MarketAt(chain);
                timingVerified &= sourceMarketAt.HasValue;marketAt??=sourceMarketAt;
                if(sourceMarketAt!=marketAt)throw new InvalidDataException("Source market event changed across expiry reads");
                var received=chain.FetchedAt.Value.ToUniversalTime();
                if(!chain.RawSourcePayload.IsEmpty&&!chain.RawSourcePayload.Equals(rawAnchor)){
                    var candidateHash=Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(chain.RawSourcePayload.Span));
                    if(rawHash is not null&&rawHash!=candidateHash)throw new InvalidDataException("Provider raw revision changed across expiry reads");
                    rawHash=store.RecordProviderBody(chain.Source,chain.RawSourcePayload,chain.AsOf.Value,received);rawAnchor=chain.RawSourcePayload;
                }
                object Map(OptionContract c)=>new {strike=c.Strike,impliedVolatility=c.ImpliedVolatility,openInterest=c.OpenInterest,bid=c.Bid,ask=c.Ask,lastPrice=c.Last,volume=c.Volume,lastTradeDate=c.LastTradeTime?.ToUnixTimeSeconds(),inTheMoney=c.InTheMoney};
                missingOi+=chain.Contracts.Count(c=>c.OpenInterest is null);missingIv+=chain.Contracts.Count(c=>c.OpenInterest is >0&&c.ImpliedVolatility is not >0);
                var calls=chain.Contracts.Where(c=>c.Right==OptionRight.Call).Select(Map).ToArray();var puts=chain.Contracts.Where(c=>c.Right==OptionRight.Put).Select(Map).ToArray();
                if(calls.Length==0||puts.Length==0)throw new InvalidDataException("One option side is absent");
                captures.Add(new {underlyingLastTradeAt=chain.UnderlyingLastTradeAt,sourcePublicationAt=chain.AsOf.Value,sourceTimeAligned=sourceMarketAt.HasValue,sourceTimeBasis=chain.Source=="cboe"?"reported-underlying-trade; exact option quote event time unavailable":"provider-asof",valuationAt=(sourceMarketAt??chain.AsOf.Value).ToUniversalTime().ToString("O"),expiry=new DateTimeOffset(expiry.ToDateTime(TimeOnly.MinValue),TimeSpan.Zero).ToUnixTimeSeconds(),spot=chain.UnderlyingPrice,result=new {receivedAt=received.ToString("O"),options=new[]{new {calls,puts}}}});
                provenance.Add(new {expiry,chain.Source,chain.AsOf,chain.UnderlyingLastTradeAt,chain.FetchedAt,chain.DelayMinutes,chain.IsRealtime,contracts=chain.Contracts.Count,rawPayloadSha256=rawHash,missingOi=chain.Contracts.Count(c=>c.OpenInterest is null),missingIv=chain.Contracts.Count(c=>c.OpenInterest is >0&&c.ImpliedVolatility is not >0),greeks="recomputed by original versioned source algorithm; provider Greeks are not substituted for the source model"});
            }
            catch(Exception ex) when(ex is not OperationCanceledException||!callerCt.IsCancellationRequested){AppLog.Warn("qqq-gex","Expiry capture failed: "+ex.GetType().Name);missing.Add(new {expiry,error=ex.GetType().Name});}
        }
        var bars=new List<object>();var displayBars=new List<object>();object? displayPriceMetadata=null;var matchingBars=0;var matchingRegularBars=0;object? barMetadata=null;
        var priceCutoff=marketAt??asOf;
        if(priceCutoff is not null)
        try {
            var displayCutoff=DateTimeOffset.UtcNow;
            var series=await market.GetBarsAsync(new("QQQ",BarInterval.Minute1,displayCutoff.AddDays(-7),displayCutoff),ct);
            foreach(var group in series.Bars.Where(b=>!b.Incomplete&&b.IsConsistent()&&double.IsFinite(b.Volume)&&b.Volume>=0).GroupBy(b=>b.Time.ToUnixTimeSeconds()/120).OrderBy(g=>g.Key))
            {
                var rows=group.OrderBy(b=>b.Time).ToArray();var start=DateTimeOffset.FromUnixTimeSeconds(group.Key*120);
                if(rows.Length!=2||rows[0].Time!=start||rows[1].Time!=start.AddMinutes(1)||start.AddMinutes(2)>displayCutoff)continue;
                displayBars.Add(new {timestamp=start.ToString("O"),open=rows[0].Open,high=rows.Max(b=>b.High),low=rows.Min(b=>b.Low),close=rows[1].Close,volume=rows.Sum(b=>b.Volume)});
                if(start.AddMinutes(2)>priceCutoff)continue;
                if(Meili.Core.Time.MarketClock.ToEastern(start).Date==Meili.Core.Time.MarketClock.ToEastern(priceCutoff.Value).Date){matchingBars++;if(Meili.Core.Time.MarketClock.GetSession(start)==Meili.Core.Time.MarketSession.Regular)matchingRegularBars++;}
                bars.Add(new {timestamp=start.ToString("O"),open=rows[0].Open,high=rows.Max(b=>b.High),low=rows.Min(b=>b.Low),close=rows[1].Close,volume=rows.Sum(b=>b.Volume)});
            }
            displayPriceMetadata=new {series.Source,series.AsOf,series.FetchedAt,series.DelayMinutes,series.IsRealtime,series.OfflineCache,series.Adjustment,observedAt=DateTimeOffset.UtcNow,requestedUntil=displayCutoff,valuationCutoff=priceCutoff,basis="independent-stock-display; never supplied to GEX/PCS valuation or alerts",aggregation="complete consecutive 1m pairs only; no forward fill"};
            barMetadata=new {series.Source,series.AsOf,series.FetchedAt,series.DelayMinutes,series.IsRealtime,series.OfflineCache,series.Adjustment,availableBarDates=series.Bars.Select(b=>Meili.Core.Time.MarketClock.ToEastern(b.Time).Date.ToString("yyyy-MM-dd")).Distinct().Order().ToArray(),priceCutoff,sourceTimeBasis="closed buckets end at or before reported source event; no future price bars",aggregation="complete consecutive 1m pairs only; missing buckets omitted"};
        }catch(Exception ex) when(ex is not OperationCanceledException||!callerCt.IsCancellationRequested){AppLog.Warn("qqq-gex","Price capture failed: "+ex.GetType().Name);barMetadata=new {error=ex.GetType().Name};}
        var daily=new System.Collections.Concurrent.ConcurrentDictionary<string,object>();
        try{if(captures.Count>0&&includeContext)await Parallel.ForEachAsync(new[]{"QQQ","^VIX","^VIX3M","^VXN","^GSPC","^TNX","^IRX","CL=F","GC=F","DX-Y.NYB","SPY"},new ParallelOptions{MaxDegreeOfParallelism=2,CancellationToken=ct},async(symbol,token)=>{
            try{var series=await market.GetBarsAsync(new(symbol,BarInterval.Day1,DateTimeOffset.UtcNow.AddYears(-3)),token);daily[symbol]=new {source=series.Source,asOf=series.AsOf,fetchedAt=series.FetchedAt,delayMinutes=series.DelayMinutes,isRealtime=series.IsRealtime,offlineCache=series.OfflineCache,adjustment=series.Adjustment,bars=series.Bars.Where(b=>!b.Incomplete&&b.IsConsistent()&&double.IsFinite(b.Volume)&&b.Volume>=0).OrderBy(b=>b.Time).TakeLast(1000).Select(b=>new {date=b.Time.UtcDateTime.ToString("yyyy-MM-dd"),timestamp=b.Time.ToUniversalTime().ToString("O"),open=b.Open,high=b.High,low=b.Low,close=b.Close,volume=b.Volume}).ToArray()};}
            catch(Exception ex)when(ex is not OperationCanceledException){AppLog.Warn("qqq-gex","Daily context capture failed for "+symbol+": "+ex.GetType().Name);daily[symbol]=new {error=ex.GetType().Name,bars=Array.Empty<object>()};}
        });
        }catch(OperationCanceledException)when(!callerCt.IsCancellationRequested){AppLog.Warn("qqq-gex","Daily context deadline reached; retained partial source input");}
        IReadOnlyList<Meili.Core.Models.Quote> macroQuotes=[];
        try{if(captures.Count>0&&includeContext)macroQuotes=await market.GetQuotesAsync(["^GSPC","^VIX","^VIX3M","^TNX","^IRX","CL=F","GC=F","DX-Y.NYB","SPY"],ct);}
        catch(Exception ex)when(ex is not OperationCanceledException||!callerCt.IsCancellationRequested){AppLog.Warn("qqq-gex","Macro quote capture unavailable: "+ex.GetType().Name);}
        var evaluationAt=DateTimeOffset.UtcNow.ToString("O");
        var sourceTimeAligned=timingVerified&&marketAt.HasValue;
        var qualityComplete=sourceTimeAligned&&captures.Count==expected.Length&&matchingRegularBars>0&&missingOi==0&&missingIv==0;
        var document=new {symbol="QQQ",source=source??"unavailable",basis="normalized-provider-input",receivedAt=evaluationAt,evaluationAt,marketInputs=new {contextDeferred=!includeContext,daily,macro=new {quotes=macroQuotes,coverage="actual routed quotes; missing/stale inputs reject macro computation"},optionSource=source,optionSnapshotAsOf=marketAt??asOf,optionPublicationAsOf=asOf,sourceMarketAt=marketAt,sourceTimeBasis="CBOE uses reported underlying trade, not inferred option quote event time",underlyingLastTradeAt,optionDelayMinutes=delayKnown?(int?)maxDelay:null,optionIsRealtime=allRealtime,delayed=!allRealtime||maxDelay>0,coverage="routed provider daily observations; missing or misaligned dates block source PCS evaluation"},expectedExpiries=expected,missingExpiries=missing,captures,bars,displayPrices=new{schemaVersion="qqq-display-prices-v1",bars=displayBars,provenance=displayPriceMetadata},provenance,barMetadata,quality=new {missingOi,missingIv,matchingBars,matchingRegularBars,sourceTimeAligned,timing=matchingBars>0?"same-market-date-bars-present":"no-aligned-price-bars",repair="next scheduled capture retries original provider inputs; no IV inversion or timestamp shifting"},complete=false,providerCoverageComplete=qualityComplete,coverage="one observed provider snapshot; not historical completeness"};
        var body=JsonSerializer.Serialize(document);
        if(captures.Count>0){var identity=store.RecordObservedInput(body);body=store.ReadObservedInput(identity);}
        var path=Path.Combine(dataDirectory,"cache","qqq-gex-input.json");new SnapshotFile(path).Write(body);
        return new {status=captures.Count>0?"captured_input":"source_unavailable",symbol="QQQ",basis="normalized-provider-input",complete=false,providerCoverageComplete=qualityComplete,calculated=false,contextDeferred=!includeContext,expectedExpiries=expected.Length,capturedExpiries=captures.Count,missingExpiries=missing.Count,bars=bars.Count,displayBars=displayBars.Count,matchingBars,matchingRegularBars,sourceTimeAligned,missingOi,missingIv,timing=matchingBars>0?"same-market-date-bars-present":"no-aligned-price-bars",source,asOf,sourceMarketAt=marketAt,sourceDelayMinutes=delayKnown?(int?)maxDelay:null,inputPath=path,runtime="Run the pinned source calculation importer; this operation does not claim a published archive"};
    }
}
