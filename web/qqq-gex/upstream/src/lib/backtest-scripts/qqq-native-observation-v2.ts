/** Incremental native stock-account/state observations, not a historical trace input. */
import { createHash } from 'node:crypto';
import type { MarketDataSet } from '../engines/leveraged-overlay/v2/backtest/fixtures';
import type { ResolvedBacktestRunSpec } from '../engines/leveraged-overlay/v2/backtest/run-spec';
import { iterateResolvedNativeStockState, resolveNativeDecisionBars } from '../engines/leveraged-overlay/v2/backtest/native-market-coordinates-v2';
import { freezeObservationData, type StrategyObject } from './strategy-module-v2';
import type {QqqMarketContext} from './qqq-market-context-v5';
import {validateNativeObservationBatch,type NativeDecisionObservation} from '../engines/leveraged-overlay/v2/backtest/native-observation-contract-v2';

export const QQQ_NATIVE_OBSERVATION_VERSION = 'qqq-native-stock-observation-sdk-v2-v3';
export function createQqqNativeObservation(data: MarketDataSet, input: ResolvedBacktestRunSpec, market?:QqqMarketContext) {
  market?.assertData(data);
  // Per-run model state must not alias caller configuration or another observer.
  input = structuredClone(input);
  if (input.config.timeframe !== '1d') throw new Error('Native SDK observation supports daily bars only');
  if (!input.config.strategyParams) throw new Error('Resolved native stock parameters required');
  const serialized = JSON.stringify(input);
  if (/BlockedDates|ByDate|canonicalOptionSignalTape|EntryGate|ContractGate/.test(serialized)) throw new Error('Native observation cannot consume admission/date artifacts');
  const spec: ResolvedBacktestRunSpec = { ...input, config: { ...input.config, trace: false,
    includeTerminalMarkOnly: true, strategyParams: { ...input.config.strategyParams,
      enablePCS: false, enableEquityBoostPCS: false, enableCS: false, enableIC: false,
      enableCollar: false, enableBearOverlay: false, pcsRescueEnabled: false } } };
  const specHash = createHash('sha256').update(JSON.stringify(spec)).digest('hex');
  const decisionBars = Object.freeze(resolveNativeDecisionBars(spec, data));
  const availability = new Set(decisionBars);
  if ((spec.signalSymbol ?? 'QQQ') !== 'QQQ') throw new Error('QQQ observation requires QQQ signal coordinates');
  const signalBars = data.barsBySymbol?.QQQ ?? data.qqqBars;
  const signalIndices = market?undefined:new Map(signalBars.map((bar, index) => [bar.date, index]));
  // Native DTE updates begin at minBarHistory, BEFORE window/leveraged availability
  // checks. Supply observations only; the strategy, not this adapter, owns DTE rules.
  let volatilityCursor = spec.config.minBarHistory ?? 200;
  let lastDate: string | null = null, finished = false;
  const iterator = iterateResolvedNativeStockState(spec, data,{
    ...(market?{marketPrecompute:market.nativePrecompute(spec)}:{}),
    snapshotObservation(value){
      const endIndexExclusive = (market?market.data.indexOf(signalBars,value.asOf):signalIndices!.get(value.asOf))! + 1;
      const volatilityDecisionInputs = validateNativeObservationBatch({ firstIndex: volatilityCursor, endIndexExclusive,
        values: signalBars.slice(volatilityCursor, endIndexExclusive).map(bar => {
          const value = data.vxnByDate[bar.date];
          return typeof value === 'number' && Number.isFinite(value) ? value : null;
        }) },volatilityCursor);
      // One fresh validated copy at the native yield seam; mutable native state never escapes or freezes.
      const snapshot=freezeObservationData({...value,
        ...(market?{macro:{...value.macro,vxnHistory:market.volatilityHistory(value.asOf,value.macro.vxnHistory)}}:{}),
        volatilityDecisionInputs},Boolean(market));
      volatilityCursor = endIndexExclusive;
      return snapshot as unknown as NativeDecisionObservation;
    },
  });
  return {
    version: QQQ_NATIVE_OBSERVATION_VERSION, specHash, dataFingerprint: data.fingerprint, resolvedSpec: structuredClone(spec), decisionBars,
    availableOn: (asOf: string) => availability.has(asOf),
    advanceTo(asOf: string): StrategyObject {
      if (finished || (lastDate !== null && asOf <= lastDate)) throw new Error('Native observation must advance chronologically');
      const next = iterator.next();
      if (next.done || next.value.asOf !== asOf) {
        finished = true; iterator.return(undefined as never);
        throw new Error(`Native observation calendar mismatch: expected ${asOf}, observed ${next.done ? 'end' : next.value.asOf}`);
      }
      lastDate = asOf;
      return next.value as unknown as StrategyObject;
    },
    close() { if (!finished) iterator.return(undefined as never); finished = true; },
  };
}
