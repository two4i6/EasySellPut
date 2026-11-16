using Meili.Core.Diagnostics;
using System.Text.Json;
using Meili.Core.Abstractions;
using Meili.Core.Models;
using Meili.Core.Settings;

namespace Meili.Automation;

/// <summary>Export routed provider inputs for the single maintained GEX calculation runtime.</summary>
public sealed class QqqGexCaptureService(IMarketDataService market,string dataDirectory)
{
    public async Task<object> CaptureAsync(CancellationToken ct=default)
    {
        var store=new Meili.Data.Cache.QqqGexResponseStore(Path.Combine(dataDirectory,"cache","qqq-gex.db"));
        var expected=(await market.GetExpirationsAsync("QQQ",ct)).Distinct().Order().ToArray();
        if(expected.Length is 0 or >128)return new {status="source_unavailable",symbol="QQQ",complete=false,reason="Expiry index must contain 1–128 dates"};
        ReadOnlyMemory<byte> rawAnchor=default;string? rawHash=null;var missingOi=0;var missingIv=0;
        var captures=new List<object>();var missing=new List<object>();var provenance=new List<object>();string? source=null;DateTimeOffset? asOf=null;double? spot=null;
        foreach(var expiry in expected)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var chain=await market.GetChainAsync("QQQ",expiry,ct);
                if(chain.AsOf is null||chain.FetchedAt is null||chain.UnderlyingPrice is not >0||!double.IsFinite(chain.UnderlyingPrice.Value)||chain.Contracts.Count==0||chain.Contracts.Any(c=>c.Expiration!=expiry)||chain.Contracts.GroupBy(c=>(c.Right,c.Strike)).Any(g=>g.Count()>1))throw new InvalidDataException("Missing source time/spot, wrong expiry or duplicate contract");
                source??=chain.Source;asOf??=chain.AsOf;spot??=chain.UnderlyingPrice;
                if(chain.Source!=source||chain.AsOf!=asOf||chain.UnderlyingPrice!=spot)throw new InvalidDataException("Source, snapshot time or underlying spot changed across expiry reads");
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
                captures.Add(new {valuationAt=chain.AsOf.Value.ToUniversalTime().ToString("O"),expiry=new DateTimeOffset(expiry.ToDateTime(TimeOnly.MinValue),TimeSpan.Zero).ToUnixTimeSeconds(),spot=chain.UnderlyingPrice,result=new {receivedAt=received.ToString("O"),options=new[]{new {calls,puts}}}});
                provenance.Add(new {expiry,chain.Source,chain.AsOf,chain.FetchedAt,chain.DelayMinutes,chain.IsRealtime,contracts=chain.Contracts.Count,rawPayloadSha256=rawHash,missingOi=chain.Contracts.Count(c=>c.OpenInterest is null),missingIv=chain.Contracts.Count(c=>c.OpenInterest is >0&&c.ImpliedVolatility is not >0),greeks="recomputed by original versioned source algorithm; provider Greeks are not substituted for the source model"});
            }
            catch(Exception ex) when(ex is not OperationCanceledException){AppLog.Warn("qqq-gex","Expiry capture failed: "+ex.GetType().Name);missing.Add(new {expiry,error=ex.GetType().Name});}
        }
        var bars=new List<object>();var matchingBars=0;object? barMetadata=null;
        if(asOf is not null)
        try {
            var series=await market.GetBarsAsync(new("QQQ",BarInterval.Minute1,asOf.Value.AddDays(-7),asOf),ct);
            foreach(var group in series.Bars.Where(b=>!b.Incomplete&&b.IsConsistent()&&double.IsFinite(b.Volume)&&b.Volume>=0).GroupBy(b=>b.Time.ToUnixTimeSeconds()/120).OrderBy(g=>g.Key))
            {
                var rows=group.OrderBy(b=>b.Time).ToArray();var start=DateTimeOffset.FromUnixTimeSeconds(group.Key*120);
                if(rows.Length!=2||rows[0].Time!=start||rows[1].Time!=start.AddMinutes(1)||start.AddMinutes(2)>asOf)continue;
                if(Meili.Core.Time.MarketClock.ToEastern(start).Date==Meili.Core.Time.MarketClock.ToEastern(asOf.Value).Date)matchingBars++;
                bars.Add(new {timestamp=start.ToString("O"),open=rows[0].Open,high=rows.Max(b=>b.High),low=rows.Min(b=>b.Low),close=rows[1].Close,volume=rows.Sum(b=>b.Volume)});
            }
            barMetadata=new {series.Source,series.AsOf,series.FetchedAt,series.DelayMinutes,series.IsRealtime,series.OfflineCache,series.Adjustment,availableBarDates=series.Bars.Select(b=>Meili.Core.Time.MarketClock.ToEastern(b.Time).Date.ToString("yyyy-MM-dd")).Distinct().Order().ToArray(),aggregation="complete consecutive 1m pairs only; missing buckets omitted"};
        }catch(Exception ex) when(ex is not OperationCanceledException){AppLog.Warn("qqq-gex","Price capture failed: "+ex.GetType().Name);barMetadata=new {error=ex.GetType().Name};}
        var qualityComplete=captures.Count==expected.Length&&matchingBars>0&&missingOi==0&&missingIv==0;
        var document=new {symbol="QQQ",source=source??"unavailable",basis="normalized-provider-input",receivedAt=DateTimeOffset.UtcNow.ToString("O"),expectedExpiries=expected,missingExpiries=missing,captures,bars,provenance,barMetadata,quality=new {missingOi,missingIv,matchingBars,timing=matchingBars>0?"same-market-date-bars-present":"no-aligned-price-bars",repair="next scheduled capture retries original provider inputs; no IV inversion or timestamp shifting"},complete=false,providerCoverageComplete=qualityComplete,coverage="one observed provider snapshot; not historical completeness"};
        var body=JsonSerializer.Serialize(document);
        if(captures.Count>0){var identity=store.RecordObservedInput(body);body=store.ReadObservedInput(identity);}
        var path=Path.Combine(dataDirectory,"cache","qqq-gex-input.json");new SnapshotFile(path).Write(body);
        return new {status=captures.Count>0?"captured_input":"source_unavailable",symbol="QQQ",basis="normalized-provider-input",complete=false,providerCoverageComplete=qualityComplete,calculated=false,expectedExpiries=expected.Length,capturedExpiries=captures.Count,missingExpiries=missing.Count,bars=bars.Count,matchingBars,missingOi,missingIv,timing=matchingBars>0?"same-market-date-bars-present":"no-aligned-price-bars",source,asOf,inputPath=path,runtime="Run the pinned source calculation importer; this operation does not claim a published archive"};
    }
}
