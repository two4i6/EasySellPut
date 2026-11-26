import { qqqNetGexKing } from './qqqGexSummary';
import { calculateQqqGex, normalizeQqqGexOption, QQQ_GEX_CALCULATION_VERSION } from './qqqGexCalculation';
import { qqqMarketSession } from './qqqMarketSession';
import {qqqQuoteTiming} from './qqqQuoteTiming';
import {exposureValues} from './qqqExposureWorkbench';

type YahooOption = Record<string, unknown>;
const easternDateKey = (date: Date) => qqqMarketSession(date).date;
const sourceIso=(seconds:unknown)=>typeof seconds==='number'&&seconds>0&&Number.isFinite(new Date(seconds*1000).getTime())?new Date(seconds*1000).toISOString():null;
function calendarDaysUntilExpiration(expiry: number, now: Date) { return Math.round((Date.parse(new Date(expiry*1000).toISOString().slice(0,10)+'T00:00:00Z')-Date.parse(easternDateKey(now)+'T00:00:00Z'))/86400000); }
/** Shared, versioned GEX/Greeks model for scheduled and local ingestion. */
export function buildQqqGexCapture(now: Date, expiry: number, result: any, spot: number) {
    const receivedAt = result?.receivedAt;
    const optionSet = result?.options?.[0];
    const rawCalls = Array.isArray(optionSet?.calls) ? optionSet.calls as YahooOption[] : [];
    const rawPuts = Array.isArray(optionSet?.puts) ? optionSet.puts as YahooOption[] : [];
    const stockSeconds=result?.quote?.regularMarketTime;
    const stockAt=sourceIso(stockSeconds);
    const latestTrade=Math.max(0,...[...rawCalls,...rawPuts].map(c=>typeof c.lastTradeDate==='number'&&Number.isFinite(c.lastTradeDate)?c.lastTradeDate:0));
    const quoteTiming=qqqQuoteTiming({receivedAt:typeof receivedAt==='string'?receivedAt:'',underlyingQuoteAt:stockAt,optionQuoteAt:null,latestTradeAt:sourceIso(latestTrade)});
    const calls = rawCalls.map(option => normalizeQqqGexOption(option, { expiry, now, spot, type: 'call', receivedAt }));
    const puts = rawPuts.map(option => normalizeQqqGexOption(option, { expiry, now, spot, type: 'put', receivedAt }));
    const calculation = calculateQqqGex({ calls, puts }, spot, new Date(expiry * 1000).toISOString().slice(0, 10), now.toISOString());
    if (!calculation) return null;
    const { metrics } = calculation;
    const callWall = metrics.points.find(point => point.isCallWall && point.callGEX > 0) ?? null;
    const putWall = metrics.points.find(point => point.isPutWall && point.putGEX > 0) ?? null;
    // King is the largest absolute net exposure across the full chain.
    const king = qqqNetGexKing(metrics.points, point => point.totalGEX);
    const frame={time:now.getTime(),profiles:[{expiry:new Date(expiry*1000).toISOString().slice(0,10),strikes:calculation.profile}],missing:[]};
    const capturedDelta=(p:{callDelta?:number;putDelta?:number},side:'call'|'put')=>side==='call'?p.callDelta:p.putDelta;
    const delta=exposureValues(frame,'delta',spot,undefined,capturedDelta),charm=exposureValues(frame,'charm',spot,undefined,capturedDelta);
    return {
      expiryDate: new Date(expiry * 1_000).toISOString().slice(0, 10), dte: calendarDaysUntilExpiration(expiry, now), spot,
      netGex: metrics.totalGexValue, gammaFlip: metrics.gammaFlipPrice,
      callWallPrice: callWall?.strike ?? null, callWallMagnitude: callWall?.callGEX ?? null,
      putWallPrice: putWall?.strike ?? null, putWallMagnitude: putWall ? -putWall.putGEX : null,
      kingStrike: king?.strike ?? null, kingMagnitude: king?.magnitude ?? null,
      kingSide: king?.side ?? null,
      indicators: {
        schemaVersion:'qqq-capture-indicators-v1', calculationVersion:QQQ_GEX_CALCULATION_VERSION,
        valuationAt:now.toISOString(), sourceAsOf:calculation.sourceAsOf, inputComplete:calculation.complete,
        pricing:{rate:0,dividend:0,contractMultiplier:100,gexUnit:'per-1pct',thetaUnit:'usd-per-share-per-day',vegaUnit:'usd-per-share-per-1pct-iv'},
        atmIv:calculation.atmIv>0?calculation.atmIv:null, atmIvMethod:calculation.atmIvMethod,
        expectedMove:calculation.atmIv>0?metrics.expectedMove:null,
        pcrRaw:calculation.complete&&calls.reduce((n,c)=>n+(c.openInterest??0),0)>0?metrics.pcrRaw:null,
        pcrDeltaWeighted:calculation.complete&&calculation.calls.some(c=>(c.openInterest??0)>0&&Math.abs(c.delta??0)>0)?metrics.pcrDeltaWeighted:null,
        topology:calculation.complete?metrics.topology:null,
        exposure:{version:'qqq-exposure-capture-v1',spot,time:now.toISOString(),deltaUnit:'signed-usd-notional',charmUnit:'signed-usd-notional-per-minute',
          rows:[...delta].map(([strike,delta])=>({strike,delta,charm:charm.get(strike)??null})),
          validDeltaStrikes:[...delta.values()].filter(v=>v!==null).length,validCharmStrikes:[...charm.values()].filter(v=>v!==null).length},
        gammaModel:{inputQualityVersion:calculation.model.inputQualityVersion,levels:calculation.model.levels,
          spotGamma:calculation.model.spotGamma,volatilityTrigger:calculation.model.volatilityTrigger,
          expiries:calculation.model.expiries,excluded:calculation.model.excluded,reason:calculation.model.reason,dataTimes:calculation.model.dataTimes},
      },
      profile: calculation.profile.map(p=>({...p,quoteTiming})),quoteTiming, calculationVersion: QQQ_GEX_CALCULATION_VERSION, inputComplete: calculation.complete, sourceAsOf: calculation.sourceAsOf,
    };
}
