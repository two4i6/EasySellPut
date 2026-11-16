import { writeFileSync } from 'node:fs';
import { buildQqqPcsHistoricalBacktestSpec } from '../../src/lib/engines/analysis/QqqPcsHistoricalBacktest';
import type { BacktestTraceEntry, OptionCycleDebug } from '../../src/lib/engines/leveraged-overlay/backtest/types';
import { loadFixture } from '../../src/lib/engines/leveraged-overlay/v2/backtest/fixtures';
import { runWithData, type V2BacktestResult } from '../../src/lib/engines/leveraged-overlay/v2/backtest/runner';

type Result = V2BacktestResult & { debug?: { optionCycles?: OptionCycleDebug[]; trace?: BacktestTraceEntry[] } };
export type Row = { date: string; pnl: number; regime: string; prevRegime?: string; regimeTransition?: string; prevSlowSubregime?: string; regimeAge?: number; rv20: number; adx: number; sma: number; atr: number; roc5: number; vix?: number; roc20?: number; weakening?: number; rsi14?: number; drawdown?: number; slowSubregime?: string; slowSubregimePosterior?: number; slowSubregimeHealth?: string; vixTermStructureSlope?: number; vixChange5d?: number; ma50Slope?: number; sma20Slope?: number; qqqEr20?: number; trendScore?: number; tqqqRoc20?: number; fillFallback?: boolean; pairSearch?: boolean };
type Arms = { safeHigh: Row[]; safeLow: Row[]; aggressiveHigh: Row[]; aggressiveLow: Row[] };
export type Scope = 'soft_pool' | 'selective_quality_v49_bull_tail_no_adx' | 'selective_quality_v50_bull_tail_atr_ge_neg025' | 'selective_quality_v51_bull_tail_atr_ge_neg05' | 'selective_quality_v52_bull_tail_atr_ge_neg1' | 'selective_quality_v53_side_mid_adx_rv90' | 'selective_quality_v54_side_mid_adx_rv95' | 'selective_quality_v55_side_mid_adx_rv100' | 'selective_quality_v56_side_adx_ge16' | 'selective_quality_v57_side_adx_ge14' | 'selective_quality_v58_side_adx14_atr2' | 'selective_quality_v59_bull_adx_ge13' | 'selective_quality_v60_range_atr225' | 'selective_quality_v61_range_atr25' | 'selective_quality_v62_risk_ext_adx_lt30_atr2' | 'selective_quality_v63_side_adx12_atr2_roc5ge0' | 'selective_quality_v64_side_adx12_atr2' | 'selective_quality_v65_side_adx12_roc5ge0' | 'selective_quality_v66_side_atr2_roc5ge0' | 'selective_quality_v67_risk_ext_sma_ge19' | 'selective_quality_v68_risk_ext_sma_ge20' | 'selective_quality_v69_risk_ext_sma_ge22' | 'selective_quality_v70_combined_e70_sma22' | 'selective_quality_v71_combined_sma21' | 'selective_quality_v72_slim_no_bull_tail' | 'selective_quality_v73_slim_preserve_core_bull_tail' | 'selective_quality_v74_risk_ext_roc5_lt0' | 'selective_quality_v75_risk_ext_sma15_roc5_lt0' | 'selective_quality_v76_risk_ext_sma17_roc5_lt0' | 'selective_quality_v77_risk_ext_weakening_ge1' | 'selective_quality_v78_risk_ext_weakening_sma9' | 'selective_quality_v79_risk_ext_weakening_momentum' | 'selective_quality_v80_risk_ext_weakening_roc20' | 'selective_quality_v81_risk_ext_weakening_drawdown' | 'selective_quality_v82_risk_ext_drawdown05_1_vix15' | 'selective_quality_v83_risk_ext_drawdown05_1_vix15_atr35' | 'selective_quality_v84_risk_ext_drawdown05_1_vix15_atr35_no_weakening' | 'selective_quality_v86_risk_ext_drawdown05_1_vix15_roc20_8' | 'selective_quality_v87_risk_ext_drawdown05_1_vix15_roc20_8_on_e99' | 'selective_quality_v88_risk_ext_atr35_ge_on_e105' | 'selective_quality_v89_risk_ext_atr35_vix13_on_e105' | 'selective_quality_v90_risk_ext_atr35_vix14_on_e105' | 'selective_quality_v91_risk_ext_atr35_sma12_17_on_e111' | 'selective_quality_v92_risk_ext_sma15_vix13_roc20_8_on_e121' | 'selective_quality_v93_risk_ext_vix13_roc20_8_on_e121' | 'selective_quality_v94_risk_ext_sma15_roc20_8_on_e121' | 'selective_quality_v95_risk_ext_sma15_vix13_on_e121';

const FIXTURE = 'market-2026-09-09-vxn';
const START = '2010-01-01';
const END = '2026-09-09';
const ROLLING_START_YEAR = 2010;
const ROLLING_WINDOWS = 15;
const SCOPES: readonly Scope[] = [
  'selective_quality_v49_bull_tail_no_adx',
  'selective_quality_v50_bull_tail_atr_ge_neg025',
  'selective_quality_v51_bull_tail_atr_ge_neg05',
  'selective_quality_v52_bull_tail_atr_ge_neg1',
];
const OUTPUT = 'src/lib/engines/leveraged-overlay/backtest/reports/pcs-rescue-r5-e56-bull-atr-frontier-new-snapshot-2010-2026.json';
const REPORT = 'src/lib/engines/leveraged-overlay/backtest/reports/pcs-rescue-r5-e56-bull-atr-frontier-new-snapshot-2010-2026.md';

const day = (value: string | undefined) => (value ?? '').slice(0, 10);
const round = (value: number) => +value.toFixed(2);
function basic(input: readonly Row[]) {
  const pnls = input.map(row => row.pnl); const sorted = [...pnls].sort((a, b) => a - b); const tailN = pnls.length ? Math.max(1, Math.ceil(pnls.length * .05)) : 0;
  let equity = 0; let peak = 0; let mdd = 0; for (const pnl of pnls) { equity += pnl; peak = Math.max(peak, equity); mdd = Math.min(mdd, equity - peak); }
  const losses = pnls.filter(pnl => pnl < 0).length;
  return { n: pnls.length, losses, wr: pnls.length ? round((pnls.length - losses) / pnls.length * 100) : 0, pnl: round(pnls.reduce((sum, pnl) => sum + pnl, 0)), cvar5: round(tailN ? sorted.slice(0, tailN).reduce((sum, pnl) => sum + pnl, 0) / tailN : 0), worst: round(sorted[0] ?? 0), mdd: round(mdd) };
}
export function summary(input: readonly Row[], rollingStartYear = ROLLING_START_YEAR, rollingWindows = ROLLING_WINDOWS) {
  const windows = Array.from({ length: rollingWindows }, (_, i) => basic(input.filter(row => row.date >= `${rollingStartYear + i}-01-01` && row.date <= `${rollingStartYear + i + 2}-12-31`)));
  return { ...basic(input), holdoutPnl: basic(input.filter(row => row.date >= '2025-01-01')).pnl, rollingMinWr: Math.min(...windows.map(window => window.wr)), rollingMaxLosses: Math.max(...windows.map(window => window.losses)), rollingWorstMdd: Math.min(...windows.map(window => window.mdd)) };
}
export function rows(result: Result): Row[] {
  const opens = new Map((result.tradeLog ?? []).filter(trade => trade.action === 'OPEN' && trade.strategyTag).map(trade => [day(trade.date), trade] as const));
  const orderedTraces = [...(result.debug?.trace ?? [])].sort((a, b) => day(a.date).localeCompare(day(b.date)));
  const traces = new Map(orderedTraces.map(trace => [day(trace.date), trace] as const));
  const fillFallbackDates = new Set(orderedTraces.filter(trace => trace.pcsRescueExecution?.reason === 'opened_fill_fallback').map(trace => day(trace.date)));
  const pairSearchDates = new Set(orderedTraces.filter(trace => trace.pcsRescueExecution?.reason === 'opened_pair_search').map(trace => day(trace.date)));
  const previous = new Map(orderedTraces.map((trace, index) => [day(trace.date), orderedTraces[index - 1]] as const));
  const regimeAges = new Map<string, number>(); let age = 0; let lastRegime = '';
  for (const trace of orderedTraces) { const current = String(trace.marketState?.regime ?? 'UNKNOWN'); age = current === lastRegime ? age + 1 : 1; lastRegime = current; regimeAges.set(day(trace.date), age); }
  return (result.debug?.optionCycles ?? []).filter((cycle): cycle is OptionCycleDebug & { pnl: number } => cycle.kind === 'PCS_RESCUE' && Number.isFinite(cycle.pnl)).map(cycle => {
    const openDate = day(cycle.openDate); const date = day(opens.get(openDate)?.signalDate ?? openDate);
    const market = ((traces.get(date) as unknown as { marketState?: Record<string, unknown> } | undefined)?.marketState ?? {}) as Record<string, unknown>;
    const previousMarket = ((previous.get(date) as unknown as { marketState?: Record<string, unknown> } | undefined)?.marketState ?? {}) as Record<string, unknown>;
    const num = (...keys: string[]) => keys.map(key => Number(market[key])).find(value => Number.isFinite(value)) ?? Number.NaN;
    const regime = String(market.regime ?? 'UNKNOWN'); const prevRegime = String(previousMarket.regime ?? 'UNKNOWN');
    return { date, pnl: cycle.pnl, regime, prevRegime, regimeTransition: `${prevRegime}->${regime}`, prevSlowSubregime: String(previousMarket.slowSubregime ?? 'UNKNOWN'), regimeAge: regimeAges.get(date), rv20: num('tqqqRealisedVol20d', 'rv20'), adx: num('adx14'), sma: num('priceVsSma200Pct', 'price_vs_sma200_pct'), atr: num('priceExtensionAtr', 'price_extension_atr'), roc5: num('qqqROC5', 'roc5'), vix: num('vix'), roc20: num('roc20', 'qqqROC20'), weakening: num('weakeningSignalCount'), rsi14: num('rsi14'), drawdown: num('drawdownFromRecentHighPct'), slowSubregime: String(market.slowSubregime ?? 'UNKNOWN'), slowSubregimePosterior: num('slowSubregimePosterior'), slowSubregimeHealth: String(market.slowSubregimeHealth ?? 'UNKNOWN'), vixTermStructureSlope: num('vixTermStructureSlope'), vixChange5d: num('vixChange5d'), ma50Slope: num('ma50SlopePct'), sma20Slope: num('sma20SlopePct'), qqqEr20: num('qqqEr20'), trendScore: num('trendScore'), tqqqRoc20: num('tqqqRoc20'), fillFallback: fillFallbackDates.has(date), pairSearch: pairSearchDates.has(date) };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

export type RescueTraceEvent = { date: string; pnl: number; regime: string; adx: number; atr: number; roc20?: number; weakening?: number; remainingBefore: number; originRegime?: string; originDate?: string; lateBase: boolean; lateExpanded: boolean; lateRoc20: boolean; extendedRelease: boolean; released: boolean };
export type RescueStageEvent = { stage: 'low_built' | 'high_built' | 'final'; date: string; pnl: number; regime: string; adx: number; atr: number; roc20?: number; weakening?: number };
export type RescueOptions = { lateAdxMax?: number; lateRequiresWeakening?: boolean; lateRoc20Min?: number; extendedAtrMax?: number; normalAdxMin?: number; normalRoc5Min?: number; deltaMode?: 'range_smart_quality_v32' | 'range_smart_quality_v33'; contractFallbackMode?: 'none' | 'narrow_updelta_v1' | 'narrow_updelta_v2' | 'narrow_updelta_sideways_v1' | 'narrow_downdelta_v1' | 'narrow_width_v1' | 'expiry28_v1' | 'expiry42_v1'; contractFallbackDeltaUplift?: number; pairSearchMode?: 'nearest_valid_v1' | 'nearest_valid_calm_v1' | 'nearest_valid_calm_vix20_v1' | 'nearest_valid_side_weak_vix20_v1' | 'nearest_valid_bull_vix12_v1' | 'nearest_valid_bull_vix13_adx10_v1' | 'nearest_valid_bull_vix14_adx15_v1' | 'nearest_valid_bull_vix14_adx20_v1' | 'nearest_valid_bull_vix15_adx10_v1' | 'nearest_valid_bull_vix15_adx15_v1' | 'nearest_valid_bull_vix15_adx20_v1' | 'nearest_valid_bull_vix18_adx15_v1' | 'nearest_valid_bull_vix15_linear_adx_v1' | 'nearest_valid_bull_vix15_linear_adx_m51_v1' | 'nearest_valid_bull_vix15_linear_adx_m52_v1' | 'nearest_valid_side_vix20_bull_vix12_v1' | 'nearest_valid_side_vix20_bull_vix13_v1' | 'nearest_valid_side_vix20_bull_vix13_adx10_v1' | 'nearest_valid_range_vix20_adx20_v1' | 'nearest_valid_range_v1' | 'nearest_valid_side_v1' | 'nearest_valid_side_rv55_v1' | 'nearest_valid_side_adx20_v1' | 'nearest_valid_side_vix20_v1' | 'nearest_valid_side_vix22_v1' | 'nearest_valid_width_cap_v1' | 'nearest_valid_risk_cap_v1' | 'quote_only_width_v1' | 'nearest_valid_delta_cap_v1' | 'nearest_valid_credit_floor_v1'; pairSearchIndependent?: boolean; v123ReleaseClass?: 'current' | 'a9_only' | 'b30_only' | 'c10_only'; nativeP0A9QualityRelease?: boolean; promoteOnMainFailure?: boolean; fillFallbackMode?: 'next_chain_delta_v1' | 'next_chain_delta_core_v1' | 'next_chain_delta_calm_v1'; fillFallbackIndependent?: boolean; trace?: RescueTraceEvent[]; stageTrace?: RescueStageEvent[]; rawResults?: Array<{ key: string; result: Result }> };
function rescue(input: readonly Row[], options: RescueOptions = {}): Row[] {
  const kept: Row[] = []; let remaining = 0; let origin: Row | undefined;
  const lateAdxMax = options.lateAdxMax ?? 30;
  const extendedAtrMax = options.extendedAtrMax ?? 1.8;
  const skip = (row: Row) => row.regime === 'RANGE_BOUND' || row.regime === 'RISK_ON_EXTENDED' ? 4 : 3;
  for (const row of input) {
    if ((options.fillFallbackIndependent && row.fillFallback) || (options.pairSearchIndependent && row.pairSearch)) { kept.push(row); continue; }
    if (remaining > 0) {
      const lateBase = origin?.regime === 'RISK_ON_EXTENDED' && row.regime === 'RISK_ON_EXTENDED' && remaining <= 3 && row.adx < 30;
      const lateExpanded = origin?.regime === 'RISK_ON_EXTENDED' && row.regime === 'RISK_ON_EXTENDED' && remaining <= 3 && row.adx < lateAdxMax && (row.weakening ?? 0) >= 1;
      const lateRoc20 = origin?.regime === 'RISK_ON_EXTENDED' && row.regime === 'RISK_ON_EXTENDED' && remaining <= 3 && Number.isFinite(options.lateRoc20Min) && Number.isFinite(row.roc20) && row.roc20! >= options.lateRoc20Min!;
      const late = options.lateRoc20Min !== undefined
        ? lateBase || lateExpanded || lateRoc20
        : options.lateRequiresWeakening ? lateBase || lateExpanded : origin?.regime === 'RISK_ON_EXTENDED' && row.regime === 'RISK_ON_EXTENDED' && remaining <= 3 && row.adx < lateAdxMax;
      const normalRelease = !!origin && origin.regime === 'BULL' && ((remaining === 1 && row.adx >= 28) || (remaining === 2 && row.adx >= 28 && row.rv20 >= .20));
      const extendedRelease = !!origin && origin.regime === 'RISK_ON_EXTENDED' && row.regime === 'RISK_ON_EXTENDED' && remaining === 2 && row.adx >= 35 && row.atr < extendedAtrMax;
      const release = !!origin && (origin.regime === 'RISK_ON_EXTENDED' && row.regime === 'BULL' || origin.regime === 'RANGE_BOUND' && ((row.regime === 'RISK_ON_EXTENDED' && remaining >= 3) || (row.regime === 'RANGE_BOUND' && remaining === 1)) || late || normalRelease || extendedRelease);
      options.trace?.push({ date: row.date, pnl: row.pnl, regime: row.regime, adx: row.adx, atr: row.atr, roc20: row.roc20, weakening: row.weakening, remainingBefore: remaining, originRegime: origin?.regime, originDate: origin?.date, lateBase, lateExpanded, lateRoc20, extendedRelease, released: release });
      if (release) kept.push(row); remaining -= 1; continue;
    }
    const boundary = origin?.regime === 'RISK_ON_EXTENDED' && origin.atr >= 4 && row.regime === 'BULL' && row.rv20 < .25;
    if (boundary) { remaining = skip(row); origin = row; continue; }
    kept.push(row); if (row.pnl <= 0 && row.adx >= 16) remaining = skip(row); origin = row;
  }
  return kept;
}
function fallbackRows(high: readonly Row[], low: readonly Row[]): Row[] {
  const lowByDate = new Map(low.map(row => [row.date, row] as const));
  return high.flatMap(row => row.regime === 'RISK_ON_EXTENDED' && row.sma >= .20 && lowByDate.has(row.date) ? [lowByDate.get(row.date)!] : [row]);
}
function envelope(aggressive: readonly Row[], safe: readonly Row[]): Row[] {
  const safeByDate = new Map(safe.map(row => [row.date, row] as const));
  return aggressive.flatMap(row => row.regime === 'RISK_ON_EXTENDED' && (row.atr >= 3.2 || row.adx < 13) && safeByDate.has(row.date) ? [safeByDate.get(row.date)!] : [row]);
}
function build(arms: Arms, options: RescueOptions = {}): Row[] {
  return envelope(fallbackRows(rescue(arms.aggressiveHigh, options), rescue(arms.aggressiveLow, options)), fallbackRows(rescue(arms.safeHigh, options), rescue(arms.safeLow, options)));
}
function selectArms(low: Arms, mid: Arms, side: Arms, range: Arms): Arms {
  const pick = (a: readonly Row[], b: readonly Row[], c: readonly Row[], d: readonly Row[]) => {
    const maps = [a, b, c, d].map(items => new Map(items.map(row => [row.date, row] as const)));
    return [...new Set(maps.flatMap(map => [...map.keys()]))].sort().flatMap(date => {
      const lo = maps[0].get(date);
      const mi = maps[1].get(date);
      const si = maps[2].get(date);
      const ra = maps[3].get(date);
      if (si?.regime === 'SIDEWAYS') return [si];
      if (ra?.regime === 'RANGE_BOUND' && ra.adx >= 5) return [ra];
      if ((mi?.adx ?? Number.NEGATIVE_INFINITY) >= 5) return mi ? [mi] : [];
      return lo ? [lo] : [];
    });
  };
  return { safeHigh: pick(low.safeHigh, mid.safeHigh, side.safeHigh, range.safeHigh), safeLow: pick(low.safeLow, mid.safeLow, side.safeLow, range.safeLow), aggressiveHigh: pick(low.aggressiveHigh, mid.aggressiveHigh, side.aggressiveHigh, range.aggressiveHigh), aggressiveLow: pick(low.aggressiveLow, mid.aggressiveLow, side.aggressiveLow, range.aggressiveLow) };
}
function dynamicNormal(base: readonly Row[], high: readonly Row[], options: RescueOptions = {}): Row[] {
  const b = new Map(base.map(row => [row.date, row] as const)); const h = new Map(high.map(row => [row.date, row] as const));
  const normalAdxMin = options.normalAdxMin ?? 16; const normalRoc5Min = options.normalRoc5Min ?? -.0025;
  return [...new Set([...b.keys(), ...h.keys()])].sort().flatMap(date => { const hi = h.get(date); const lo = b.get(date); return hi && hi.regime === 'RANGE_BOUND' && hi.atr < 1.5 && (hi.adx >= normalAdxMin || hi.roc5 >= normalRoc5Min) ? [hi] : lo ? [lo] : []; });
}
export async function runScope(data: Awaited<ReturnType<typeof loadFixture>>, spec: ReturnType<typeof buildQqqPcsHistoricalBacktestSpec>, tape: NonNullable<Result['config']['canonicalOptionSignalTape']>, fingerprint: NonNullable<Result['config']['canonicalOptionSignalDataFingerprint']>, scope: Scope, options: RescueOptions = {}): Promise<Row[]> {
  const run = async (base: number, fallback: number, pressure: number, normal: number) => {
    const key = `${base}-${fallback}-${pressure}-${normal}`;
    const result = runWithData({ ...spec, config: { ...spec.config, includeTerminalMarkOnly: true, canonicalOptionSignalTape: tape, canonicalOptionSignalDataFingerprint: fingerprint }, strategyOverrides: { ...spec.strategyOverrides, pcsRescueEnabled: true, pcsRescueEntryMode: 'reactive_soft_pool' as const, pcsRescueRegimeScope: scope, pcsRescueDeltaMode: options.deltaMode ?? 'range_smart_quality_v33', pcsRescueExtremeDelta: .2425, pcsRescueExtremeBaseDelta: base, pcsRescueExtremeFallbackDelta: fallback, pcsRescueCalmDelta: .1839, pcsRescueNormalDelta: normal, pcsRescuePressureDelta: pressure, pcsRescueWidthPct: .0218, pcsRescueExtremeWidthPct: .055, pcsRescueTargetDte: 35, pcsRescueRiskBudgetNav: .005, pcsRescueContractFallbackMode: options.contractFallbackMode ?? 'none', pcsRescueContractFallbackDeltaUplift: options.contractFallbackDeltaUplift, pcsRescuePairSearchMode: options.pairSearchMode, ...(options.v123ReleaseClass ? { pcsV123ReleaseClass: options.v123ReleaseClass } : {}), ...(options.nativeP0A9QualityRelease !== undefined ? { pcsNativeP0A9QualityRelease: options.nativeP0A9QualityRelease } : {}), ...(options.promoteOnMainFailure ? { pcsRescuePromoteOnMainFailure: true } : {}), ...(options.fillFallbackMode ? { pcsRescueFillFallbackMode: options.fillFallbackMode } : {}) } }, data) as Result;
    options.rawResults?.push({ key, result });
    return rows(result);
  };
  const packages = new Map<string, Arms>();
  for (const pressure of [.04, .0425, .0601, .0428]) for (const normal of [.135, .1481]) {
    const [safeHigh, safeLow, aggressiveHigh, aggressiveLow] = await Promise.all([run(.2075, .206, pressure, normal), run(.2075, .18, pressure, normal), run(.2325, .206, pressure, normal), run(.2325, .18, pressure, normal)]);
    packages.set(`${pressure}-${normal}`, { safeHigh, safeLow, aggressiveHigh, aggressiveLow });
  }
  const get = (pressure: number, normal: number) => packages.get(`${pressure}-${normal}`)!;
  const low = selectArms(get(.04, .135), get(.0425, .135), get(.0601, .135), get(.0428, .135));
  const high = selectArms(get(.04, .1481), get(.0425, .1481), get(.0601, .1481), get(.0428, .1481));
  const lowBuilt = build(low, options); const highBuilt = build(high, options);
  options.stageTrace?.push(...lowBuilt.map(row => ({ stage: 'low_built' as const, date: row.date, pnl: row.pnl, regime: row.regime, adx: row.adx, atr: row.atr, roc20: row.roc20, weakening: row.weakening })), ...highBuilt.map(row => ({ stage: 'high_built' as const, date: row.date, pnl: row.pnl, regime: row.regime, adx: row.adx, atr: row.atr, roc20: row.roc20, weakening: row.weakening })));
  const final = dynamicNormal(lowBuilt, highBuilt, options);
  options.stageTrace?.push(...final.map(row => ({ stage: 'final' as const, date: row.date, pnl: row.pnl, regime: row.regime, adx: row.adx, atr: row.atr, roc20: row.roc20, weakening: row.weakening })));
  return final;
}

const main = async () => {
  const data = await loadFixture(FIXTURE); const spec = buildQqqPcsHistoricalBacktestSpec({ startDate: START, endDate: END, replayVariant: 'v1_2_6', strikeMode: 'delta', exitMode: 'hold_to_expiry' });
  const seed = runWithData({ ...spec, config: { ...spec.config, includeTerminalMarkOnly: true } }, data) as Result; const tape = seed.config.canonicalOptionSignalTape; const fingerprint = seed.config.canonicalOptionSignalDataFingerprint;
  if (!tape || !fingerprint) throw new Error(`Frozen canonical tape required for ${FIXTURE}`);
  const resultRows = []; const parent = await runScope(data, spec, tape, fingerprint, SCOPES[0]); const parentDates = new Set(parent.map(row => row.date));
  for (const scope of SCOPES) { const selected = scope === SCOPES[0] ? parent : await runScope(data, spec, tape, fingerprint, scope); const stats = summary(selected); const added = selected.filter(row => !parentDates.has(row.date)); const value = { scope, ...stats, rows: selected, addedCount: scope === SCOPES[0] ? 0 : added.length, addedWins: scope === SCOPES[0] ? 0 : added.filter(row => row.pnl > 0).length, addedLosses: scope === SCOPES[0] ? 0 : added.filter(row => row.pnl < 0).length, addedPnl: scope === SCOPES[0] ? 0 : round(added.reduce((sum, row) => sum + row.pnl, 0)) }; resultRows.push(value); console.log(`RESULT ${FIXTURE} ${scope} ${stats.n}/${stats.losses}/${stats.wr}/${stats.pnl} added=${value.addedCount}/${value.addedLosses}/${value.addedPnl} tail=${stats.cvar5}/${stats.worst}/${stats.mdd}`); }
  writeFileSync(OUTPUT, `${JSON.stringify([{ fixture: FIXTURE, base: { scope: SCOPES[0], ...summary(parent) }, results: resultRows }], null, 2)}\n`);
  const lines = ['# R5.E56：BULL 低 VIX ATR 下限前沿（新快照）', '', `- 快照：\`${FIXTURE}\`，窗口 \`${START}～${END}\`。`, '- 父候选：R5.E55；唯一变量是 BULL + VIX<12 的 priceExtensionATR 下限。', '- 固定：v1_2_6、纯 PCS、EB off、35 DTE、canonical tape、R5 delta/width/cooldown/Envelope/dynamic Normal。', '', '| 方案 | 笔数 | 亏损 | 胜率 | P&L | 相对父候选开仓 | 新增亏损 | 增量 P&L | CVaR5 | 最差 / MDD | 2025+ P&L |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|']; for (const value of resultRows) lines.push(`| ${value.scope} | ${value.n} | ${value.losses} | ${value.wr}% | $${value.pnl.toFixed(2)} | ${value.addedCount} | ${value.addedLosses} | $${value.addedPnl.toFixed(2)} | $${value.cvar5.toFixed(2)} | $${value.worst.toFixed(2)} / $${value.mdd.toFixed(2)} | $${value.holdoutPnl.toFixed(2)} |`); lines.push('', '本报告仅为 research-only 结果，不修改默认配置。'); writeFileSync(REPORT, `${lines.join('\n')}\n`);
};
if (import.meta.main) await main();
