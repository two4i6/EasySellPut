/** Complete independent strategy policy. Native observers supply facts, never PCS decisions. */
import type { BarStrategyModule, StrategyJson, StrategyObject, StrategyStep } from '../strategy-module-v2';
import { assertFixedStrategyParams,freezeStrategyData } from '../strategy-module-v2';
import {scalePrimaryVolatilityTerm,resolveVolatilityCoordinates} from '../market-coordinates-v3';
import {projectNativePcsMarketContext} from '../native-market-facts-v7';
import type { PcsDynamicEntryContext, PcsDynamicMarketState } from '../../engines/leveraged-overlay/types/input';
import type { PcsAnalyticalProbe } from '../qqq-pcs-analytics-v2';
import { isReactivePcsTiming } from '../../engines/analysis/PcsReactiveRule';
import {isPcsBass232Candidate2GateBlocked} from '../../engines/leveraged-overlay/v2/strategies/standalone-policy-gates-v1';
import { initializeP6Settlement, applyP6Settlement, evaluateP6E385Admission,
  P6_E385_EFFECTIVE_PARAMETERS, P6_E385_LINEAGE, type P6SettlementState } from './p6-e385-decision-v2';
import { p6E385Width, p6E385SelectionScope, selectP6E385Contract, selectP6SourceContract } from './p6-e385-selection-v1';
import { P6_E385_RUNTIME_CONTRACT } from './p6-e385-parameters-v2';
import {stressOnlyPcsSelectionProfile} from '../pcs-selection-v6';
import {createAdmissionTrace} from '../strategy-admission-v1';

type State = P6SettlementState & { history: StrategyObject[] };
const defaults: StrategyObject = freezeStrategyData({ ...P6_E385_EFFECTIVE_PARAMETERS, lineage: [...P6_E385_LINEAGE],
  ...P6_E385_RUNTIME_CONTRACT,
  probeWidths: [...P6_E385_RUNTIME_CONTRACT.probeWidths], probeSigmas: [...P6_E385_RUNTIME_CONTRACT.probeSigmas] });
export const p6E385StandaloneV2: BarStrategyModule = {
  manifest: { sdkVersion: 2, id: 'P6.E385', version: 'p6-e385-standalone-current-bar-v2-slim-state', researchOnly: true,
    migration: { complete: true, missing: [] } },
  params: defaults,
  initialize(params) { assertFixedStrategyParams(params,defaults); return { ...initializeP6Settlement(), history: [] }; },
  planObservations({asOf,params,nativeState,annualizedQqqRv20}) {
    assertFixedStrategyParams(params,defaults);
    const market = nativeState.marketContext as StrategyObject, macro = nativeState.macro as StrategyObject;
    const primaryVol = Number(macro.vxn ?? macro.vix);
    const primaryVol3m = typeof macro.vix3m === 'number' ? scalePrimaryVolatilityTerm(primaryVol,Number(macro.vix),macro.vix3m) : undefined;
    const common = {asOf,regime:String(market.regime),slowSubregime:String(market.slowSubregime),annualizedQqqRv20};
    const scope = p6E385SelectionScope({...common,primaryVol,primaryVol3m,
      rv20:typeof market.tqqqRealisedVol20d === 'number' ? market.tqqqRealisedVol20d : undefined});
    const source = p6E385SelectionScope({...common,primaryVol:Number(macro.vix),
      primaryVol3m:typeof macro.vix3m === 'number' ? macro.vix3m : undefined});
    return {widths:[scope.width],sigmas:stressOnlyPcsSelectionProfile(scope.stressed && source.stressed).candidateSigmas,
      targetDte:P6_E385_EFFECTIVE_PARAMETERS.targetDte,nav:Number((nativeState.stockAccount as StrategyObject).netLiquidation),
      riskBudget:P6_E385_RUNTIME_CONTRACT.riskBudgetNav,forceMinimumContract:P6_E385_RUNTIME_CONTRACT.forceMinimumContract,includeTail:scope.tailVetoActive};
  },
  onFeedback({ state, params, feedback }) {
    assertFixedStrategyParams(params,defaults);
    const s = state as unknown as State;
    return { ...s, ...applyP6Settlement(s, feedback) } as unknown as StrategyJson;
  },
  onBar(input) { return decideP6E385CurrentBar(input); },
};


/** Shared current-bar kernel; versioned modules supply a fixed admission function. */
export function decideP6E385CurrentBar(input:Parameters<BarStrategyModule["onBar"]>[0], evaluateAdmission:typeof evaluateP6E385Admission=evaluateP6E385Admission):StrategyStep {
  const {state,snapshot,params}=input;
    assertFixedStrategyParams(params,defaults);
    const s = state as unknown as State, native = snapshot.market.nativeState as StrategyObject;
    const trace=createAdmissionTrace(['上游数据','源策略安全','生存率合约','来源合约','动态准入']);
    if (!native || native.available === false) return { state, intents: [], plots: { reason: 'native-warmup-unavailable',gates:trace.gates } };
    const market = native.marketContext as StrategyObject;
    if (!market || !market.regime) throw new Error('Missing native as-of market context');
    // Effective lineage only uses last-three patterns and stable-run thresholds <=10.
    // Nine preceding observations plus this bar preserve every predicate without growing traces.
    const nextState = { ...s, history: [...s.history, market].slice(-9) };
    const noTrade = (reason: string) => ({ state: nextState as unknown as StrategyJson, intents: [], plots: { reason,gates:trace.gates } });
    const upstream = native.upstreamStatuses as Record<string, string>;
    trace.check(0,!Object.values(upstream).some(status=>status==='BLOCK'||status==='ERROR'),'上游观测与数据质量检查');
    if (Object.values(upstream).some(status => status === 'BLOCK' || status === 'ERROR')) return noTrade('upstream-block');
    const regime = String(market.regime), slowSubregime = String(market.slowSubregime ?? '');
    // Flattened Candidate2 source eligibility: three current-state shields that
    // the retained runner encoded in its canonical signal tape. Never read that tape.
    const adx = Number(market.adx14 ?? -Infinity), roc20 = Number(market.roc20 ?? Infinity);
    const rv = Number(market.tqqqRealisedVol20d ?? Infinity);
    if (isPcsBass232Candidate2GateBlocked({enabled:true,regime,slowSubregime,adx14:adx,roc20,
      tqqqRealisedVol20d:rv,priceVsSma200Pct:Number(market.priceVsSma200Pct ?? -Infinity),
      drawdownFromRecentHighPct:Number(market.drawdownFromRecentHighPct ?? Infinity)})) {trace.check(1,false,'source-Candidate2-shield');return noTrade('source-Candidate2-shield');}
    const phase = String(native.crisisPhase);
    const safety = regime !== 'CRISIS' && regime !== 'BEAR' && phase !== 'CONFIRMED' && phase !== 'PENDING';
    trace.check(1,safety,'Candidate2 源闸与 PCS 危机安全检查');
    if (!safety) return noTrade('PCS-safety');
    if (params.cooldownTradingDays !== 0) throw new Error('Unsupported P6 cooldown override');
    const analytics = snapshot.market.pcsAnalytics as StrategyObject;
    if (!analytics) throw new Error('PCS candidate analytics missing');
    const candidates = (analytics.candidates as unknown as PcsAnalyticalProbe[]).filter(c => c.widthPct === p6E385Width(slowSubregime));
    const macro = native.macro as StrategyObject;
    const vix = Number(macro.vix), vix3m = typeof macro.vix3m === 'number' ? macro.vix3m : undefined;
    const coordinates=resolveVolatilityCoordinates(macro,{positiveVixRequired:false,rawTermFallback:false,coerceVix:true});
    const primaryVol = coordinates.primaryVol ?? vix;
    const primaryVol3m = coordinates.primaryVol3m;
    const selection = selectP6E385Contract({ asOf: snapshot.asOf, regime, slowSubregime,
      rv20: typeof market.tqqqRealisedVol20d === 'number' ? market.tqqqRealisedVol20d : undefined,
      primaryVol, primaryVol3m, annualizedQqqRv20: Number(analytics.annualizedQqqRv20), candidates });
    trace.check(2,!!selection,selection?'生存率筛选已选出合约':'no-survival-contract');
    if (!selection) return noTrade('no-survival-contract');
    const sourceSelection = selectP6SourceContract({ asOf: snapshot.asOf, regime, slowSubregime,
      primaryVol: vix, primaryVol3m: vix3m, annualizedQqqRv20: Number(analytics.annualizedQqqRv20), candidates });
    trace.check(3,!!sourceSelection,sourceSelection?'来源合约前置条件通过':'source-contract-unavailable');
    if (!sourceSelection) return noTrade('source-contract-unavailable');
    const source = candidates[sourceSelection.selectedIndex]!;
    const selected = candidates[selection.selectedIndex]!;
    const current = projectNativePcsMarketContext(market, primaryVol, primaryVol3m);
    const context: PcsDynamicEntryContext = { ...current, date: snapshot.asOf,
      history: [...s.history, current] as PcsDynamicMarketState[],
      selectedSigma: selected.sigma, selectedNoTouchLower: selection.diagnostic.selectedNoTouchLower,
      openCredit: selected.credit, shortStrike: selected.shortStrike, longStrike: selected.longStrike, expiry: selected.expiry,
      hasOpenPcs: false, safetyConditionsMet: safety, streakCooldownBlocked: false,
      normalP4GatePassed: safety, normalP4SignalPassed: safety && isReactivePcsTiming('QQQ', regime, vix, phase, vix3m ?? NaN),
    } as PcsDynamicEntryContext;
    const admission = evaluateAdmission(context, s);
    trace.check(4,admission.allowed,admission.reason);
    if (!admission.allowed) return noTrade(admission.reason);
    return { state: nextState as unknown as StrategyJson, plots: { reason: admission.reason, selectedSigma: selected.sigma,gates:trace.gates },
      intents: [{ kind: 'open-spread', key: `p6-e385:${snapshot.asOf}`, contract: { symbol: 'QQQ', type: 'put',
        expiry: selected.expiry, shortStrike: selected.shortStrike, longStrike: selected.longStrike, targetDte: P6_E385_EFFECTIVE_PARAMETERS.targetDte },
        risk: { multiplier: 1, ratioMin: 0, ratioMax: Number.MAX_VALUE, entrySource: 'p6-e385',
          fillPrerequisite: { expiry: source.expiry, shortStrike: source.shortStrike, longStrike: source.longStrike, targetDte: P6_E385_EFFECTIVE_PARAMETERS.targetDte } } }] };

}
