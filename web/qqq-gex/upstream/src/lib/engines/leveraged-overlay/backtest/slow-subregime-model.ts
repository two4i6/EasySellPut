import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createDerivedFactor, createRawFactor, isValidPrice, isValidVix } from '../../../factor';
import type { FactorMap, FinancialFactor } from '../../../../types/factor';
import { adjustedRandIndex, advanceStudentTHsmmFilter, classifyStudentTHsmm, fitStudentTHsmm, runLengths, type HsmmFilterState, type HsmmProfile } from './generalized-hsmm';
import { run } from '../v2/backtest/runner';

const SNAPSHOT = 'docs/overlay-tuning/fixtures/slow-subregime-market-2026-07-02.json';
const TRAIN = ['2003-01-02', '2007-12-31'] as const, VALIDATION = ['2008-01-01', '2010-12-31'] as const, OOS = ['2011-01-03', '2026-07-02'] as const;
export type SlowSubregimePoint = { observedAt: string; availableAt?: string; value: number };
export type SlowSubregimeSeries = { source: string; field: string; checksum: string; points: SlowSubregimePoint[] };
export type SlowSubregimeSnapshot = { asOf: string; end: string; availabilityRule: string; prices: Record<string, SlowSubregimeSeries>; volatility: Record<string, SlowSubregimeSeries>; rates: Record<string, SlowSubregimeSeries> };
type Point = SlowSubregimePoint;
type Series = SlowSubregimeSeries;
type Snapshot = SlowSubregimeSnapshot;
type Group = 'trend' | 'volatility' | 'credit' | 'rates' | 'cross_asset';
type Feature = { id: string; group: Group; values: Map<string, FinancialFactor<number>>; coverage: number; decision: string };
type Row = { date: string; factors: FactorMap; values: number[] };
type Candidate = { k: number; dwell: number; profile: HsmmProfile; validationMean: number; validationSe: number; bicImprovement: number; llImprovement: number; occupancy: number; segments: number; medianDwell: number; flipsPerYear: number; posterior: number; bootstrapMedian?: number; bootstrapP10?: number; ablationMedian?: number; pass: boolean; reason: string };

export type SlowSubregimeArtifact = {
  artifactVersion: 1;
  modelVersion: 'slow-subregime-sr-v1';
  generatedAt: string;
  snapshotChecksum: string;
  availabilityRule: string;
  featureIds: string[];
  normalization: { centers: number[]; scales: number[] };
  profile: HsmmProfile;
  training: { train: readonly [string, string]; validation: readonly [string, string]; oos: readonly [string, string]; validationMean: number; validationSe: number; bicImprovement: number; llImprovement: number };
  semantics: readonly ['防御压力', '趋势扩张'];
  history: Array<{ effectiveDate: string; observationCutoff: string; state: 'SR01' | 'SR02'; posterior: [number, number] }>;
  terminalFilter: HsmmFilterState;
  checksum: string;
};

const table = (headers: string[], rows: string[][]) => [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map(row => `| ${row.join(' | ')} |`)].join('\n');
const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const median = (values: readonly number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) / 2)]; };
const quantile = (values: readonly number[], q: number) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) * q)]; };
const sd = (values: readonly number[]) => Math.sqrt(mean(values.map(value => (value - mean(values)) ** 2)));
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const byAvailability = (series: Series) => new Map(series.points.flatMap(point => point.availableAt ? [[point.availableAt, point.value] as const] : []));
const validNumber = (value: number) => Number.isFinite(value);

export function createResearchDerivedFactor(id: string, value: number, inputs: Array<[string, number, (value: number) => boolean, string]>): FinancialFactor<number> | undefined {
  if (!Number.isFinite(value)) return undefined;
  const factors: FactorMap = {};
  for (const [factorId, raw, validate, api] of inputs) { const factor = createRawFactor(raw, validate, api); if (factor.source.type === 'fallback') return undefined; factors[factorId] = factor; }
  return createDerivedFactor(value, inputs.map(([factorId]) => ({ factorId, weight: 1 / inputs.length })), factors);
}

const derived = createResearchDerivedFactor;

function buildFeatures(snapshot: Snapshot, endDate: string = OOS[1]): { features: Feature[]; dates: string[] } {
  const prices = Object.fromEntries(Object.entries(snapshot.prices).map(([id, series]) => [id, byAvailability(series)])) as Record<string, Map<string, number>>;
  const vols = Object.fromEntries(Object.entries(snapshot.volatility).map(([id, series]) => [id, byAvailability(series)])) as Record<string, Map<string, number>>;
  const rates = Object.fromEntries(Object.entries(snapshot.rates).map(([id, series]) => [id, byAvailability(series)])) as Record<string, Map<string, number>>;
  const dates = [...prices.QQQ.keys()].filter(date => date >= TRAIN[0] && date <= endDate);
  const candidates: Array<{ id: string; group: Group; calculate: (date: string, i: number) => FinancialFactor<number> | undefined }> = [];
  const ratioRoc = (id: string, group: Group, left: string, right: string, lag: number) => candidates.push({ id, group, calculate: (date, i) => {
    const lagDate = dates[i - lag]; if (!lagDate) return undefined;
    const a = prices[left].get(date), b = prices[right].get(date), la = prices[left].get(lagDate), lb = prices[right].get(lagDate);
    if ([a, b, la, lb].some(value => value == null)) return undefined;
    return derived(id, (a! / b!) / (la! / lb!) - 1, [[`${left}_adj`, a!, isValidPrice, `${left}:adjusted-close`], [`${right}_adj`, b!, isValidPrice, `${right}:adjusted-close`], [`${left}_lag`, la!, isValidPrice, `${left}:adjusted-close`], [`${right}_lag`, lb!, isValidPrice, `${right}:adjusted-close`]]);
  }});
  candidates.push({ id: 'qqq_roc63', group: 'trend', calculate: (date, i) => { const lag = dates[i - 63], now = prices.QQQ.get(date), before = lag ? prices.QQQ.get(lag) : undefined; return now != null && before != null ? derived('qqq_roc63', now / before - 1, [['qqq_adj', now, isValidPrice, 'QQQ:adjusted-close'], ['qqq_lag63', before, isValidPrice, 'QQQ:adjusted-close']]) : undefined; } });
  candidates.push({ id: 'qqq_ma200_distance', group: 'trend', calculate: (date, i) => { const history = dates.slice(i - 199, i + 1).map(day => prices.QQQ.get(day)); const now = prices.QQQ.get(date); return history.length === 200 && now != null && history.every(value => value != null) ? derived('qqq_ma200_distance', now / mean(history as number[]) - 1, (history as number[]).map((value, index) => [`qqq_ma200_input_${index}`, value, isValidPrice, 'QQQ:adjusted-close'])) : undefined; } });
  candidates.push({ id: 'qqq_drawdown252', group: 'trend', calculate: (date, i) => { const history = dates.slice(i - 251, i + 1).map(day => prices.QQQ.get(day)); const now = prices.QQQ.get(date); return history.length === 252 && now != null && history.every(value => value != null) ? derived('qqq_drawdown252', now / Math.max(...history as number[]) - 1, (history as number[]).map((value, index) => [`qqq_drawdown_input_${index}`, value, isValidPrice, 'QQQ:adjusted-close'])) : undefined; } });
  ratioRoc('qqq_spy_ratio_roc63', 'trend', 'QQQ', 'SPY', 63); ratioRoc('rsp_spy_ratio_roc63', 'trend', 'RSP', 'SPY', 63); ratioRoc('iwm_spy_ratio_roc63', 'trend', 'IWM', 'SPY', 63); ratioRoc('xly_xlp_ratio_roc63', 'trend', 'XLY', 'XLP', 63);
  ratioRoc('lqd_tlt_ratio_roc63', 'credit', 'LQD', 'TLT', 63); ratioRoc('hyg_tlt_ratio_roc63', 'credit', 'HYG', 'TLT', 63); ratioRoc('tlt_spy_ratio_roc63', 'cross_asset', 'TLT', 'SPY', 63); ratioRoc('gld_tlt_ratio_roc63', 'cross_asset', 'GLD', 'TLT', 63); ratioRoc('uso_spy_ratio_roc63', 'cross_asset', 'USO', 'SPY', 63); ratioRoc('uup_spy_ratio_roc63', 'cross_asset', 'UUP', 'SPY', 63); ratioRoc('cper_gld_ratio_roc63', 'cross_asset', 'CPER', 'GLD', 63);
  candidates.push({ id: 'vix_level', group: 'volatility', calculate: date => { const value = vols.VIX.get(date); return value == null ? undefined : createRawFactor(value, isValidVix, 'Cboe:VIX.close'); } });
  candidates.push({ id: 'vix_change20', group: 'volatility', calculate: (date, i) => { const lag = dates[i - 20], now = vols.VIX.get(date), before = lag ? vols.VIX.get(lag) : undefined; return now != null && before != null ? derived('vix_change20', now / before - 1, [['vix', now, isValidVix, 'Cboe:VIX.close'], ['vix_lag20', before, isValidVix, 'Cboe:VIX.close']]) : undefined; } });
  for (const [id, numerator, denominator] of [['vix_vix3m_ratio', 'VIX', 'VIX3M'], ['vxn_vix_ratio', 'VXN', 'VIX']] as const) candidates.push({ id, group: 'volatility', calculate: date => { const a = vols[numerator].get(date), b = vols[denominator].get(date); return a != null && b != null ? derived(id, a / b, [[numerator, a, isValidVix, `Cboe:${numerator}.close`], [denominator, b, isValidVix, `Cboe:${denominator}.close`]]) : undefined; } });
  for (const [short, long, id] of [['2 yr', '10 yr', 'curve_10y_2y'], ['3 mo', '10 yr', 'curve_10y_3m']] as const) candidates.push({ id, group: 'rates', calculate: date => { const a = rates[long].get(date), b = rates[short].get(date); return a != null && b != null ? derived(id, a - b, [[long, a, validNumber, `Treasury:${long}`], [short, b, validNumber, `Treasury:${short}`]]) : undefined; } });
  candidates.push({ id: 'rate_10y_change20', group: 'rates', calculate: (date, i) => { const lag = dates[i - 20], now = rates['10 yr'].get(date), before = lag ? rates['10 yr'].get(lag) : undefined; return now != null && before != null ? derived('rate_10y_change20', now - before, [['10y', now, validNumber, 'Treasury:10y'], ['10y_lag20', before, validNumber, 'Treasury:10y']]) : undefined; } });
  const eligibleDates = dates.filter((_, i) => i >= 252 && dates[i] <= VALIDATION[1]);
  const features = candidates.map(candidate => { const values = new Map<string, FinancialFactor<number>>(); dates.forEach((date, i) => { const factor = candidate.calculate(date, i); if (factor && factor.confidence > 0) values.set(date, factor); }); const coverage = eligibleDates.filter(date => values.has(date)).length / eligibleDates.length; return { id: candidate.id, group: candidate.group, values, coverage, decision: coverage >= .98 ? 'KEEP' : 'DROP coverage <98%' }; });
  return { features, dates };
}

function correlation(left: number[], right: number[]) { const lm = mean(left), rm = mean(right), numerator = left.reduce((total, value, i) => total + (value - lm) * (right[i] - rm), 0); return numerator / Math.sqrt(left.reduce((t, v) => t + (v - lm) ** 2, 0) * right.reduce((t, v) => t + (v - rm) ** 2, 0) || 1); }

function panel(features: Feature[], dates: string[]) {
  const retained = features.filter(feature => feature.coverage >= .98), completeDates = dates.filter(date => date >= TRAIN[0] && date <= OOS[1] && retained.every(feature => feature.values.has(date)));
  const trainDates = completeDates.filter(date => date <= TRAIN[1]), selected: Feature[] = [];
  for (const feature of retained) {
    const values = trainDates.map(date => feature.values.get(date)!.value);
    const duplicate = selected.some(existing => Math.abs(correlation(values, trainDates.map(date => existing.values.get(date)!.value))) >= .9);
    if (!duplicate) selected.push(feature); else feature.decision = 'DROP |corr| ≥0.90';
  }
  const centers = selected.map(feature => median(trainDates.map(date => feature.values.get(date)!.value))), scales = selected.map((feature, i) => Math.max((quantile(trainDates.map(date => feature.values.get(date)!.value), .75) - quantile(trainDates.map(date => feature.values.get(date)!.value), .25)) / 1.349, 1e-9));
  const rows: Row[] = completeDates.map(date => ({ date, factors: Object.fromEntries(selected.map(feature => [feature.id, feature.values.get(date)!])), values: selected.map((feature, i) => (feature.values.get(date)!.value - centers[i]) / scales[i]) }));
  return { selected, rows, centers, scales };
}

export function buildFrozenSlowSubregimeObservations(
  snapshot: SlowSubregimeSnapshot,
  featureIds: readonly string[],
  normalization: { centers: readonly number[]; scales: readonly number[] },
  afterDate: string,
) {
  const built = buildFeatures(snapshot, snapshot.end), byId = new Map(built.features.map(feature => [feature.id, feature]));
  const selected = featureIds.map(id => byId.get(id));
  if (selected.some(feature => !feature)) throw new Error('frozen SR feature missing');
  const cutoffByEffectiveDate = new Map(snapshot.prices.QQQ.points.flatMap(point => point.availableAt ? [[point.availableAt, point.observedAt] as const] : []));
  return built.dates.filter(date => date > afterDate && selected.every(feature => feature!.values.has(date))).map(date => ({
    date,
    observationCutoff: cutoffByEffectiveDate.get(date) ?? date,
    values: selected.map((feature, index) => (feature!.values.get(date)!.value - normalization.centers[index]!) / normalization.scales[index]!),
  }));
}

function occupancy(states: number[], k: number) { return Math.min(...Array.from({ length: k }, (_, state) => states.filter(value => value === state).length / states.length)); }
function segments(states: number[], k: number) { const lengths = runLengths(states); return Math.min(...Array.from({ length: k }, (_, state) => lengths.filter(run => run.state === state).length)); }
function seeded(seed: number) { let value = seed >>> 0; return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) / 4294967296; }; }
function bootstrapIndices(length: number, random: () => number) { const out: number[] = []; while (out.length < length) { const start = Math.floor(random() * Math.max(1, length - 60)); for (let i = 0; i < 60 && out.length < length; i++) out.push(start + i); } return out; }

function stability(data: number[][], reference: number[], k: number, dwell: number) {
  const random = seeded(20260718), scores: number[] = [];
  for (let repeat = 0; repeat < 100; repeat++) { const indices = bootstrapIndices(data.length, random), sample = indices.map(index => data[index]); const fit = fitStudentTHsmm(sample, k, dwell, 4); scores.push(adjustedRandIndex(indices.map(index => reference[index]), classifyStudentTHsmm(sample, fit).states)); }
  return { median: median(scores), p10: quantile(scores, .1) };
}

function search(rows: Row[], selected: Feature[]) {
  const train = rows.filter(row => row.date <= TRAIN[1]), validation = rows.filter(row => row.date >= VALIDATION[0] && row.date <= VALIDATION[1]), combined = [...train, ...validation];
  const baseline = fitStudentTHsmm(train.map(row => row.values), 1, 1), baselineScore = classifyStudentTHsmm(combined.map(row => row.values), baseline), baselineValidation = baselineScore.dailyLogLikelihood.slice(train.length);
  const candidates: Candidate[] = [];
  for (const k of [2, 3, 4, 5, 6, 7, 8]) for (const dwell of [10, 20, 40]) {
    const profile = fitStudentTHsmm(train.map(row => row.values), k, dwell), trainResult = classifyStudentTHsmm(train.map(row => row.values), profile), result = classifyStudentTHsmm(combined.map(row => row.values), profile), validationStates = result.states.slice(train.length), validationDaily = result.dailyLogLikelihood.slice(train.length), improvements = validationDaily.map((value, i) => value - baselineValidation[i]);
    const parameterCount = k * selected.length * 2 + k, baselineParameters = selected.length * 2 + 1, bicImprovement = (-2 * baselineValidation.reduce((a, b) => a + b, 0) + baselineParameters * Math.log(validation.length)) - (-2 * validationDaily.reduce((a, b) => a + b, 0) + parameterCount * Math.log(validation.length));
    const runs = runLengths(result.states), years = (new Date(`${combined.at(-1)!.date}T00:00:00Z`).getTime() - new Date(`${combined[0].date}T00:00:00Z`).getTime()) / 31557600000;
    const cheap = { occupancy: Math.min(occupancy(trainResult.states, k), occupancy(validationStates, k)), segments: segments(validationStates, k), medianDwell: median(runs.map(run => run.length)), flipsPerYear: (runs.length - 1) / years, posterior: median(result.posterior.map(row => Math.max(...row))) };
    const failures = [bicImprovement < 10 && 'BIC', mean(improvements) <= 0 && 'LL', cheap.occupancy < .05 && 'occupancy', cheap.segments < 3 && 'segments', cheap.medianDwell < 20 && 'dwell', cheap.flipsPerYear > 6 && 'flips', cheap.posterior < .6 && 'posterior'].filter(Boolean) as string[];
    const candidate: Candidate = { k, dwell, profile, validationMean: mean(validationDaily), validationSe: sd(validationDaily) / Math.sqrt(validationDaily.length), bicImprovement, llImprovement: mean(improvements), ...cheap, pass: false, reason: failures.join(', ') || 'stability pending' };
    if (!failures.length) {
      const stable = stability(train.map(row => row.values), trainResult.states, k, dwell); candidate.bootstrapMedian = stable.median; candidate.bootstrapP10 = stable.p10;
      const ablations = [...new Set(selected.map(feature => feature.group))].flatMap(group => { const keep = selected.map((feature, i) => feature.group === group ? -1 : i).filter(index => index >= 0); if (!keep.length) return []; const reducedTrain = train.map(row => keep.map(index => row.values[index])), reducedCombined = combined.map(row => keep.map(index => row.values[index])); const fit = fitStudentTHsmm(reducedTrain, k, dwell); return [adjustedRandIndex(validationStates, classifyStudentTHsmm(reducedCombined, fit).states.slice(train.length))]; });
      candidate.ablationMedian = median(ablations); const stabilityFailures = [stable.median < .65 && 'bootstrap median', stable.p10 < .45 && 'bootstrap p10', candidate.ablationMedian < .6 && 'ablation'].filter(Boolean) as string[]; candidate.pass = !stabilityFailures.length; candidate.reason = stabilityFailures.join(', ') || 'PASS';
    }
    candidates.push(candidate);
  }
  const passing = candidates.filter(candidate => candidate.pass), best = passing.reduce<Candidate | undefined>((value, candidate) => !value || candidate.validationMean > value.validationMean ? candidate : value, undefined);
  const selectedCandidate = best && passing.filter(candidate => candidate.validationMean >= best.validationMean - best.validationSe).sort((a, b) => a.k - b.k || b.dwell - a.dwell)[0];
  return { candidates, selectedCandidate, train, validation, combined };
}

export async function buildSlowSubregimeArtifact(): Promise<SlowSubregimeArtifact> {
  const text = await readFile(SNAPSHOT, 'utf8'), snapshot = JSON.parse(text) as Snapshot;
  const built = buildFeatures(snapshot), prepared = panel(built.features, built.dates), selected = search(prepared.rows, prepared.selected).selectedCandidate;
  if (!selected || selected.k !== 2 || selected.dwell !== 10) throw new Error('frozen SR02 candidate no longer resolves to K=2/dwell=10');
  const cutoffByEffectiveDate = new Map(snapshot.prices.QQQ.points.flatMap(point => point.availableAt ? [[point.availableAt, point.observedAt] as const] : []));
  let terminalFilter: HsmmFilterState | undefined;
  const history = prepared.rows.map(row => {
    const step = advanceStudentTHsmmFilter(selected.profile, row.values, terminalFilter);
    terminalFilter = step.filter;
    return {
      effectiveDate: row.date,
      observationCutoff: cutoffByEffectiveDate.get(row.date) ?? row.date,
      state: (step.filter.state === 1 ? 'SR02' : 'SR01') as 'SR01' | 'SR02',
      posterior: step.posterior as [number, number],
    };
  });
  if (!terminalFilter) throw new Error('empty frozen SR history');
  const payload = {
    artifactVersion: 1 as const,
    modelVersion: 'slow-subregime-sr-v1' as const,
    generatedAt: '2026-07-18',
    snapshotChecksum: sha(text),
    availabilityRule: snapshot.availabilityRule,
    featureIds: prepared.selected.map(feature => feature.id),
    normalization: { centers: prepared.centers, scales: prepared.scales },
    profile: selected.profile,
    training: { train: TRAIN, validation: VALIDATION, oos: OOS, validationMean: selected.validationMean, validationSe: selected.validationSe, bicImprovement: selected.bicImprovement, llImprovement: selected.llImprovement },
    semantics: ['防御压力', '趋势扩张'] as const,
    history,
    terminalFilter,
  };
  return { ...payload, checksum: sha(JSON.stringify(payload)) };
}

const LAG_PHASES = [
  ['2010-02-11', '2011-01-07'], ['2011-02-16', '2013-12-24'], ['2014-03-05', '2014-05-28'], ['2014-09-19', '2014-10-30'],
  ['2014-11-28', '2015-02-12'], ['2015-03-02', '2015-07-16'], ['2015-07-20', '2017-05-24'], ['2017-06-08', '2017-07-18'],
  ['2017-07-26', '2017-10-04'], ['2018-01-26', '2023-11-17'], ['2024-03-01', '2024-06-10'], ['2024-07-10', '2026-05-04'],
] as const;
const OOS_SLICES = [['2011–2014', '2011-01-03', '2014-12-31'], ['2015–2018Q3', '2015-01-01', '2018-09-30'], ['2018Q4', '2018-10-01', '2018-12-31'], ['2019–2022', '2019-01-01', '2022-12-31'], ['2023–2026', '2023-01-01', OOS[1]]] as const;
const pointMap = (series: Series) => new Map(series.points.map(point => [point.observedAt, point.value]));
const intervalReturn = (values: Map<string, number>, dates: string[], start: string, end: string) => { const selected = dates.filter(date => date >= start && date <= end && values.has(date)); return selected.length > 1 ? values.get(selected.at(-1)!)! / values.get(selected[0])! - 1 : NaN; };
const fmt = (value: number) => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '—';

function blockConfidence(values: number[]) {
  if (!values.length) return [NaN, NaN] as const;
  const blocks: number[][] = []; for (let i = 0; i < values.length; i += 60) blocks.push(values.slice(i, i + 60));
  const random = seeded(20260718), estimates: number[] = [];
  for (let repeat = 0; repeat < 1000; repeat++) { const sample: number[] = []; while (sample.length < values.length) sample.push(...blocks[Math.floor(random() * blocks.length)]); estimates.push(mean(sample.slice(0, values.length))); }
  return [quantile(estimates, .025), quantile(estimates, .975)] as const;
}

async function postHoc(snapshot: Snapshot, prepared: ReturnType<typeof panel>, profile: HsmmProfile) {
  const allRows = prepared.rows.filter(row => row.date <= OOS[1]), inferred = classifyStudentTHsmm(allRows.map(row => row.values), profile), states = new Map(allRows.map((row, i) => [row.date, { state: inferred.states[i], confidence: inferred.posterior[i][inferred.states[i]], index: i }]));
  const oosRows = allRows.filter(row => row.date >= OOS[0]), qqq = pointMap(snapshot.prices.QQQ), tqqq = pointMap(snapshot.prices.TQQQ), qqqDates = snapshot.prices.QQQ.points.map(point => point.observedAt), qqqIndex = new Map(qqqDates.map((date, i) => [date, i]));
  const ultra = await run({ version: 1, preset: 'ultra', dataSource: { kind: 'fixture', fixtureId: 'market-2026-07-03' }, config: { startDate: '2010-02-11', endDate: OOS[1], useMockOptions: false }, strategyOverrides: { enableCollar: false, enableCS: false, enablePCS: false, enableIC: false, enableBearOverlay: false, enableEquityBoostPCS: false } });
  const curve = new Map(ultra.equityCurve.map(point => [point.date, point])), curveDates = ultra.equityCurve.map(point => point.date), curveIndex = new Map(curveDates.map((date, i) => [date, i]));
  const semanticScore = profile.means.map((center, state) => ['qqq_roc63', 'qqq_ma200_distance', 'qqq_drawdown252'].reduce((score, id) => score + center[prepared.selected.findIndex(feature => feature.id === id)], 0) - center[prepared.selected.findIndex(feature => feature.id === 'vix_level')]);
  const high = semanticScore.indexOf(Math.max(...semanticScore)), names = profile.means.map((_, state) => state === high ? '趋势扩张' : '防御压力');
  const futureRows: string[][] = [];
  for (let state = 0; state < profile.k; state++) for (const horizon of [5, 20, 60]) {
    const metrics: Record<string, number[]> = { QQQ: [], TQQQ: [], 'TQQQ-QQQ': [], 'Ultra-QQQ': [] };
    for (const row of oosRows) {
      if (states.get(row.date)?.state !== state) continue;
      const qi = qqqIndex.get(row.date), ui = curveIndex.get(row.date); if (qi == null || qi + horizon >= qqqDates.length) continue;
      const q = qqq.get(qqqDates[qi + horizon])! / qqq.get(row.date)! - 1, t = tqqq.get(qqqDates[qi + horizon])! / tqqq.get(row.date)! - 1;
      metrics.QQQ.push(q); metrics.TQQQ.push(t); metrics['TQQQ-QQQ'].push((1 + t) / (1 + q) - 1);
      if (ui != null && ui + horizon < curveDates.length) { const u = curve.get(curveDates[ui + horizon])!.nav / curve.get(row.date)!.nav - 1; metrics['Ultra-QQQ'].push((1 + u) / (1 + q) - 1); }
    }
    futureRows.push([`SR${String(state + 1).padStart(2, '0')} ${names[state]}`, String(horizon), ...Object.values(metrics).map(values => { const ci = blockConfidence(values); return `${fmt(mean(values))} [${fmt(ci[0])}, ${fmt(ci[1])}]`; })]);
  }
  const crossRows = profile.means.map((_, state) => { const rows = oosRows.filter(row => states.get(row.date)?.state === state), bull = rows.filter(row => curve.get(row.date)?.marketContext?.macroRegime === 'SLOW_BULL').length, bear = rows.filter(row => curve.get(row.date)?.marketContext?.macroRegime === 'SLOW_BEAR').length; return [`SR${String(state + 1).padStart(2, '0')} ${names[state]}`, String(rows.length), pct(bull / rows.length), pct(bear / rows.length)]; });
  const stateMix = (start: string, end: string) => profile.means.map((_, state) => oosRows.filter(row => row.date >= start && row.date <= end && states.get(row.date)?.state === state).length);
  const phaseRows = LAG_PHASES.map(([start, end]) => { const dates = qqqDates.filter(date => date >= start && date <= end), mix = stateMix(start, end), points = ultra.equityCurve.filter(point => point.date >= start && point.date <= end), transitions = oosRows.filter((row, i) => row.date >= start && row.date <= end && i > 0 && states.get(row.date)?.state !== states.get(oosRows[i - 1].date)?.state).map(row => row.date); const ultraReturn = points.length > 1 ? points.at(-1)!.nav / points[0].nav - 1 : NaN; return [`${start}..${end}`, mix.map((count, state) => `SR${state + 1}:${count}`).join(' / '), transitions.join(', ') || '无', fmt(ultraReturn), fmt(intervalReturn(qqq, dates, start, end)), fmt(intervalReturn(tqqq, dates, start, end)), fmt(mean(points.map(point => point.tqqqPct)))]; });
  const sliceRows = OOS_SLICES.map(([label, start, end]) => { const mix = stateMix(start, end), dates = qqqDates.filter(date => date >= start && date <= end); return [label, mix.map((count, state) => `SR${state + 1}:${count}`).join(' / '), fmt(intervalReturn(qqq, dates, start, end)), fmt(intervalReturn(tqqq, dates, start, end))]; });
  const specialRows = ([['2011-05-01', '2012-03-31'], ['2013-03-01', '2013-12-31']] as const).map(([start, end]) => { const rows = oosRows.filter(row => row.date >= start && row.date <= end), transitions = rows.filter((row, i) => i > 0 && states.get(row.date)?.state !== states.get(rows[i - 1].date)?.state), first = rows[0], last = rows.at(-1), changes = first && last ? prepared.selected.map((feature, i) => ({ id: feature.id, change: last.values[i] - first.values[i] })).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 3).map(row => `${row.id} ${row.change >= 0 ? '+' : ''}${row.change.toFixed(2)}σ`).join('；') : '—'; return [`${start}..${end}`, stateMix(start, end).map((count, state) => `SR${state + 1}:${count}`).join(' / '), transitions[0] ? `${transitions[0].date}（窗口起点后 ${rows.indexOf(transitions[0])} 个观测日）` : '无转换', changes]; });
  const runs = runLengths(oosRows.map(row => states.get(row.date)!.state)).sort((a, b) => b.length - a.length).slice(0, 8).map(run => [`SR${run.state + 1} ${names[run.state]}`, oosRows[run.start].date, oosRows[run.end].date, String(run.length), mean(oosRows.slice(run.start, run.end + 1).map(row => states.get(row.date)!.confidence)).toFixed(3)]);
  return { inferred, states, oosRows, names, ultra, futureRows, crossRows, phaseRows, sliceRows, specialRows, runs };
}

export async function buildSlowSubregimeReport() {
  const text = await readFile(SNAPSHOT, 'utf8'), snapshot = JSON.parse(text) as Snapshot, built = buildFeatures(snapshot), prepared = panel(built.features, built.dates), result = search(prepared.rows, prepared.selected);
  const candidateRows = result.candidates.map(candidate => [String(candidate.k), String(candidate.dwell), candidate.bicImprovement.toFixed(1), candidate.llImprovement.toFixed(4), pct(candidate.occupancy), String(candidate.segments), candidate.medianDwell.toFixed(0), candidate.flipsPerYear.toFixed(2), candidate.posterior.toFixed(3), candidate.bootstrapMedian?.toFixed(3) ?? '—', candidate.bootstrapP10?.toFixed(3) ?? '—', candidate.ablationMedian?.toFixed(3) ?? '—', candidate.pass ? 'PASS' : `FAIL: ${candidate.reason}`]);
  const selectionNote = result.selectedCandidate ? `通过候选中按“验证预测似然位于最佳值一个标准误以内 → 最小 K → 最长合格驻留”裁决，冻结 K=${result.selectedCandidate.k}, minDwell=${result.selectedCandidate.dwell}。` : '没有候选通过全部门槛。';
  const sections = ['# Slow Macro 子状态量化研究', '', '生成日期：2026-07-18。只读研究；未修改 Ultra policy、仓位逻辑、live 状态或公共类型。', '', '## 结论', '', result.selectedCandidate ? `冻结候选：\`K=${result.selectedCandidate.k}, minDwell=${result.selectedCandidate.dwell}\`。` : '**未发现可靠的新 slow regime。** 21 个预注册候选没有同时通过全部稳定性门槛；不冻结状态，不做经济结果反向调参。', '', '## 冻结数据', '', `快照：\`${SNAPSHOT}\`；SHA-256：\`${sha(text)}\`；as-of ${snapshot.asOf}；截止 ${snapshot.end}。${snapshot.availabilityRule}。`, '', table(['source group', 'series', 'field', 'first observed', 'last observed', 'count', 'checksum'], [...Object.entries(snapshot.prices), ...Object.entries(snapshot.volatility), ...Object.entries(snapshot.rates)].map(([id, series]) => [series.source.startsWith('Yahoo') ? 'market' : series.source.includes('cboe') ? 'volatility' : 'rates', id, series.field, series.points[0]?.observedAt ?? '—', series.points.at(-1)?.observedAt ?? '—', String(series.points.length), series.checksum])), '', '宏观 vintage 因仓库没有 ALFRED API key 而剔除；未用当前修订值替代。VXN、VIX3M、HYG、UUP、CPER 等晚起序列只接受为 Extended 候选，覆盖不足时不会进入 Core，也不声称对 2011–2013 有 OOS 证据。来源规则：[ALFRED/FRED 实时期](https://fred.stlouisfed.org/docs/api/fred/fred_vs_alfred.html)、[美国财政部日度曲线](https://home.treasury.gov/treasury-daily-interest-rate-xml-feed)、[Cboe 波动率历史数据](https://www.cboe.com/tradable_products/vix/vix_historical_data)。', '', '## 因子预检', '', table(['factor', 'class', 'coverage', 'decision'], built.features.map(feature => [feature.id, feature.group, pct(feature.coverage), feature.decision])), '', `训练期稳健标准化与相关性裁剪后保留：${prepared.selected.map(feature => feature.id).join('、')}。统计量只由 ${TRAIN.join('..')} 计算。`, '', `严格隔离：训练 ${TRAIN.join('..')}；验证 ${VALIDATION.join('..')}；冻结后 OOS ${OOS.join('..')}。`, '', '## 模型选择', '', 'Student-t（df=5）对角发射、显式驻留扩展、固定种子 20260718；搜索 K=2..8、最短驻留 10/20/40。稳定性使用 100 次、60 日 block bootstrap。门槛同时包括 ΔBIC≥10、held-out 日均似然改善>0、占比/片段/驻留/翻转/后验概率和逐类消融。', '', table(['K', 'min dwell', 'ΔBIC vs K=1', 'Δ daily LL', 'min occupancy', 'min val segments', 'median dwell', 'flips/year', 'median max P', 'boot ARI med', 'boot ARI p10', 'ablation ARI med', 'verdict'], candidateRows), '', selectionNote, ''];
  if (result.selectedCandidate) {
    const candidate = result.selectedCandidate, profile = await postHoc(snapshot, prepared, candidate.profile);
    sections.push(
      '## 冻结参数与语义画像', '',
      '状态编号在查看 OOS/经济结果前冻结；语义名仅由训练期因子中心排序得到，不参与模型选择。', '',
      table(['state', 'semantic name', 'raw factor centers', 'standardized scales', 'min dwell', 'tail'], candidate.profile.means.map((center, state) => [`SR${String(state + 1).padStart(2, '0')}`, profile.names[state], center.map((value, i) => `${prepared.selected[i].id}=${(prepared.centers[i] + value * prepared.scales[i]).toFixed(4)}`).join('；'), candidate.profile.scales[state].map(value => value.toFixed(4)).join(', '), String(candidate.dwell), candidate.profile.tails[state].toFixed(4)])), '',
      '## 典型 OOS 区间', '', table(['state', 'start', 'end', 'observations', 'mean confidence'], profile.runs), '',
      '## 冻结后未来收益画像', '',
      '均值与 95% CI 使用固定种子的 60 日 block bootstrap；这些经济结果在分类器冻结后计算。', '',
      table(['state', 'horizon', 'QQQ', 'TQQQ', 'TQQQ relative QQQ', 'Ultra relative QQQ'], profile.futureRows), '',
      '## 与生产 W7 主状态交叉表', '', table(['slowSubRegime', 'days', 'W7 SLOW_BULL', 'W7 SLOW_BEAR'], profile.crossRows), '',
      '## 既有 12 个 Ultra 落后阶段', '', table(['phase', 'state composition', 'transitions', 'Ultra return', 'QQQ return', 'TQQQ return', 'avg TQQQ weight'], profile.phaseRows), '',
      '## 指定阶段', '', table(['window', 'state composition', 'first transition / lag', 'largest standardized factor changes'], profile.specialRows), '',
      '## OOS 分段', '', table(['slice', 'state composition', 'QQQ return', 'TQQQ return'], profile.sliceRows), '',
      '## Ultra 经济画像 resolvedSpec', '', '```json', JSON.stringify(profile.ultra.resolvedSpec, null, 2), '```', '',
      '## 原始逐日 OOS 状态', '', table(['date', 'state', 'semantic name', 'confidence'], profile.oosRows.map(row => { const state = profile.states.get(row.date)!; return [row.date, `SR${String(state.state + 1).padStart(2, '0')}`, profile.names[state.state], state.confidence.toFixed(4)]; })), '',
    );
  } else sections.push('## 冻结状态与事后画像', '', 'N/A。没有通过门槛的模型，因此逐日状态、语义名称、状态中心、QQQ/TQQQ/Ultra 未来收益、W7 交叉表、12 个落后阶段画像和 OOS 分段画像均不发布。', '');
  return `${sections.join('\n')}\n`;
}
