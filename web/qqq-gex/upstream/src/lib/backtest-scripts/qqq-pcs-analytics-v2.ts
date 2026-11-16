/** Trusted, as-of analytical probes. No admission or winning-contract selection. */
import type { MarketDataSet } from '../engines/leveraged-overlay/v2/backtest/fixtures';
import type { OptionChain } from '../engines/leveraged-overlay/types/input';
import { PutStrikeSurvivalAsOf } from '../engines/analysis/SellerStatsEngine';
import { buildPutCreditSpreadOpen, createPutCreditSpreadPreparation } from './put-spread-kernel-v6';
import {createMarketDataModule,type MarketDataModule} from './market-data-v7';
import type { PcsSigma, PcsSurvivalSelectionCandidate } from '../engines/leveraged-overlay/v2/strategies/pcs-survival-selector';
import {assertStrategyData,type StrategyObject} from './strategy-module-v2';

export type PcsAnalyticalProbe = PcsSurvivalSelectionCandidate & { longStrike: number; expiry: string; quantity: number };
export type PcsObservationRequest={widths:readonly number[];sigmas:readonly PcsSigma[];targetDte:number;
  nav:number;riskBudget:number;forceMinimumContract:boolean;includeTail:boolean};
export function validatePcsObservationPlan(value:StrategyObject):PcsObservationRequest{
  assertStrategyData(value);const p=value as unknown as PcsObservationRequest;
  if(Object.keys(value).some(k=>!['widths','sigmas','targetDte','nav','riskBudget','forceMinimumContract','includeTail'].includes(k))
    ||!Array.isArray(p.widths)||!p.widths.length||p.widths.length>16||p.widths.some(n=>!Number.isFinite(n)||n<=0||n>=1)
    ||!Array.isArray(p.sigmas)||!p.sigmas.length||p.sigmas.length>16||p.sigmas.some(n=>![1,1.5,2,2.5].includes(n))
    ||![28,35].includes(p.targetDte)||!Number.isFinite(p.nav)||p.nav<=0||!Number.isFinite(p.riskBudget)||p.riskBudget<=0||p.riskBudget>1
    ||typeof p.forceMinimumContract!=='boolean'||typeof p.includeTail!=='boolean')throw Error('Invalid/beyond-budget PCS observation plan');
  return p;
}
export function createQqqPcsAnalytics(data: MarketDataSet, market:MarketDataModule=createMarketDataModule(data)) {
  market.assertData(data);
  const statistics = new PutStrikeSurvivalAsOf(data.qqqBars,{resultCache:'current-bar'});
  const volatilityAt = market.annualizedQqqRv20;
  return {
    volatilityAt,
    observe(asOf: string, chain: OptionChain, requests:PcsObservationRequest) {
      validatePcsObservationPlan(requests as unknown as StrategyObject);
      if(chain.symbol!=='QQQ'||chain.timestamp.split('T')[0]!==asOf||!Number.isFinite(chain.spot)||chain.spot<=0)
        throw Error('PCS analytics requires current as-of QQQ chain');
      const annualizedQqqRv20 = volatilityAt(asOf);
      const dailySigma20 = annualizedQqqRv20 / Math.sqrt(252);
      const candidates: PcsAnalyticalProbe[] = [];
      if (!(dailySigma20 > 0)) return { annualizedQqqRv20, candidates };
      const preparation = createPutCreditSpreadPreparation({chain,date:asOf,targetDte:requests.targetDte});
      for (const widthPct of requests.widths) for (const sigma of requests.sigmas) {
        const open = buildPutCreditSpreadOpen({ chain, date: asOf, underlying: 'QQQ', targetDte: requests.targetDte,
          shortDelta: .1, shortStrikeSigma: sigma, dailySigma20, widthPct, nav: requests.nav,
          riskBudget: requests.riskBudget, forceMinimumContract: requests.forceMinimumContract }, preparation).open;
        if (!open) continue;
        const {shortStrike,longStrike,credit,maxLoss,quantity,expiry}=open;
        if (shortStrike === undefined || longStrike === undefined || expiry === undefined || credit === undefined) continue;
        const horizon=market.weekdayHorizon(asOf,expiry);
        const survival = statistics.compute(asOf, chain.spot, shortStrike, dailySigma20, horizon);
        if (!survival) continue;
        const tail = requests.includeTail ? statistics.computeTail(asOf, chain.spot, shortStrike, dailySigma20, horizon,
          (shortStrike - longStrike) / chain.spot, credit, maxLoss) : null;
        // Optional analytics remain absent, not undefined (the SDK consumes finite JSON only).
        candidates.push({ sigma, widthPct, shortStrike, longStrike, expiry, credit, maxLoss, quantity,
          survival: survival.noTouch,
          ...(tail ? { tailLoss: tail.conditionalLoss, tailLossP75: tail.conditionalLossP75,
            tailLossCvar75: tail.conditionalLossCvar75, tailDropPct: tail.conditionalDropPct } : {}) });
      }
      return { annualizedQqqRv20, candidates };
    },
  };
}
