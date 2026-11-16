export type HsmmProfile = { k: number; dwell: number; means: number[][]; scales: number[][]; tails: number[] };
export type HsmmResult = { states: number[]; posterior: number[][]; logLikelihood: number; dailyLogLikelihood: number[] };
export type HsmmFilterState = {
  alpha: number[];
  logLikelihood: number;
  observations: number;
  state: number;
  stateAge: number;
};
export type HsmmFilterStep = { filter: HsmmFilterState; posterior: number[]; dailyLogLikelihood: number };

const DF = 5;
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const mean = (values: readonly number[]) => sum(values) / values.length;
const variance = (values: readonly number[], center = mean(values)) => mean(values.map(value => (value - center) ** 2));

function emissions(data: number[][], profile: HsmmProfile) {
  return data.map(row => {
    const logs = profile.means.map((center, regime) => sum(row.map((value, dimension) => {
      const scale = profile.scales[regime][dimension]; const z = (value - center[dimension]) / scale;
      return Math.log(.3796066898 / scale) - 3 * Math.log1p(z * z / DF);
    })));
    const max = Math.max(...logs);
    return { values: logs.map(value => Math.exp(value - max)), offset: max };
  });
}

function validateRow(row: readonly number[], profile: HsmmProfile) {
  if (row.length !== profile.means[0]?.length || row.some(value => !Number.isFinite(value))) throw new Error('invalid HSMM observation');
}

/** 可序列化的因果单步过滤；JSON round-trip 后可从冻结边界继续。 */
export function advanceStudentTHsmmFilter(profile: HsmmProfile, row: number[], previous?: HsmmFilterState): HsmmFilterStep {
  validateRow(row, profile);
  const { k, dwell } = profile, width = k * dwell, emission = emissions([row], profile)[0];
  const alpha = new Array(width).fill(0);
  if (!previous) {
    for (let regime = 0; regime < k; regime++) alpha[regime * dwell] = emission.values[regime] / k;
  } else {
    if (previous.alpha.length !== width) throw new Error('invalid HSMM filter state');
    for (let regime = 0; regime < k; regime++) {
      const base = regime * dwell, terminal = base + dwell - 1;
      if (k > 1) for (let from = 0; from < k; from++) if (from !== regime) alpha[base] += previous.alpha[from * dwell + dwell - 1] * (1 - profile.tails[from]) / (k - 1);
      for (let age = 1; age < dwell; age++) alpha[base + age] += previous.alpha[base + age - 1];
      alpha[terminal] += previous.alpha[terminal] * profile.tails[regime];
      for (let age = 0; age < dwell; age++) alpha[base + age] *= emission.values[regime];
    }
  }
  const normalizer = sum(alpha) || 1;
  for (let i = 0; i < alpha.length; i++) alpha[i] /= normalizer;
  const posterior = Array.from({ length: k }, (_, regime) => sum(alpha.slice(regime * dwell, (regime + 1) * dwell)));
  const rawState = posterior.indexOf(Math.max(...posterior));
  const state = previous && rawState !== previous.state && previous.stateAge < dwell ? previous.state : rawState;
  const stateAge = previous && state === previous.state ? previous.stateAge + 1 : 1;
  const dailyLogLikelihood = Math.log(normalizer) + emission.offset;
  return { posterior, dailyLogLikelihood, filter: { alpha, logLikelihood: (previous?.logLikelihood ?? 0) + dailyLogLikelihood, observations: (previous?.observations ?? 0) + 1, state, stateAge } };
}

function infer(data: number[][], profile: HsmmProfile, smooth: boolean): HsmmResult {
  const { k, dwell } = profile, width = k * dwell, emission = emissions(data, profile);
  const alpha = Array.from({ length: data.length }, () => new Array(width).fill(0));
  const normalizers = new Array(data.length).fill(1), dailyLogLikelihood = new Array(data.length).fill(0);
  for (let regime = 0; regime < k; regime++) alpha[0][regime * dwell] = emission[0].values[regime] / k;
  normalizers[0] = sum(alpha[0]) || 1; alpha[0] = alpha[0].map(value => value / normalizers[0]); dailyLogLikelihood[0] = Math.log(normalizers[0]) + emission[0].offset;
  for (let t = 1; t < data.length; t++) {
    for (let regime = 0; regime < k; regime++) {
      const base = regime * dwell, terminal = base + dwell - 1;
      if (k > 1) for (let from = 0; from < k; from++) if (from !== regime) alpha[t][base] += alpha[t - 1][from * dwell + dwell - 1] * (1 - profile.tails[from]) / (k - 1);
      for (let age = 1; age < dwell; age++) alpha[t][base + age] += alpha[t - 1][base + age - 1];
      alpha[t][terminal] += alpha[t - 1][terminal] * profile.tails[regime];
      for (let age = 0; age < dwell; age++) alpha[t][base + age] *= emission[t].values[regime];
    }
    normalizers[t] = sum(alpha[t]) || 1; alpha[t] = alpha[t].map(value => value / normalizers[t]); dailyLogLikelihood[t] = Math.log(normalizers[t]) + emission[t].offset;
  }
  let statePosterior = alpha.map(row => Array.from({ length: k }, (_, regime) => sum(row.slice(regime * dwell, (regime + 1) * dwell))));
  if (smooth) {
    const beta = Array.from({ length: data.length }, () => new Array(width).fill(1));
    for (let t = data.length - 2; t >= 0; t--) for (let regime = 0; regime < k; regime++) {
      const base = regime * dwell, terminal = base + dwell - 1;
      for (let age = 0; age < dwell - 1; age++) beta[t][base + age] = emission[t + 1].values[regime] * beta[t + 1][base + age + 1] / normalizers[t + 1];
      let value = profile.tails[regime] * emission[t + 1].values[regime] * beta[t + 1][terminal];
      if (k > 1) for (let to = 0; to < k; to++) if (to !== regime) value += (1 - profile.tails[regime]) / (k - 1) * emission[t + 1].values[to] * beta[t + 1][to * dwell];
      beta[t][terminal] = value / normalizers[t + 1];
    }
    statePosterior = alpha.map((row, t) => {
      const regimes = Array.from({ length: k }, (_, regime) => sum(row.slice(regime * dwell, (regime + 1) * dwell).map((value, age) => value * beta[t][regime * dwell + age])));
      const total = sum(regimes) || 1; return regimes.map(value => value / total);
    });
  }
  const rawStates = statePosterior.map(row => row.indexOf(Math.max(...row))), states: number[] = [];
  let current = rawStates[0], age = 0;
  for (const state of rawStates) { if (state !== current && age >= dwell) { current = state; age = 0; } states.push(current); age++; }
  return { states, posterior: statePosterior, logLikelihood: sum(dailyLogLikelihood), dailyLogLikelihood };
}

function seed(data: number[][], k: number, dwell: number): HsmmProfile {
  const dimensions = data[0].length, order = data.map((row, index) => ({ index, score: mean(row) })).sort((a, b) => a.score - b.score || a.index - b.index);
  const globalScales = Array.from({ length: dimensions }, (_, dimension) => Math.max(Math.sqrt(variance(data.map(row => row[dimension]))), 1e-3));
  const means = Array.from({ length: k }, (_, regime) => {
    const members = order.slice(Math.floor(regime * order.length / k), Math.floor((regime + 1) * order.length / k)).map(row => data[row.index]);
    return Array.from({ length: dimensions }, (_, dimension) => mean(members.map(row => row[dimension])));
  });
  return { k, dwell, means, scales: means.map(() => [...globalScales]), tails: new Array(k).fill(k === 1 ? 1 : .95) };
}

export function fitStudentTHsmm(data: number[][], k: number, dwell: number, iterations = 8): HsmmProfile {
  if (!data.length || k < 1 || dwell < 1 || data.some(row => row.length !== data[0].length || row.some(value => !Number.isFinite(value)))) throw new Error('invalid HSMM panel');
  let profile = seed(data, k, dwell);
  for (let round = 0; round < iterations; round++) {
    const inferred = infer(data, profile, true), means: number[][] = [], scales: number[][] = [];
    for (let regime = 0; regime < k; regime++) {
      const nextMeans: number[] = [], nextScales: number[] = [];
      for (let dimension = 0; dimension < data[0].length; dimension++) {
        const weights = data.map((row, t) => inferred.posterior[t][regime] * (DF + 1) / (DF + ((row[dimension] - profile.means[regime][dimension]) / profile.scales[regime][dimension]) ** 2));
        const total = sum(weights) || 1, center = sum(data.map((row, t) => row[dimension] * weights[t])) / total;
        nextMeans.push(center); nextScales.push(Math.max(Math.sqrt(sum(data.map((row, t) => weights[t] * (row[dimension] - center) ** 2)) / total), 1e-3));
      }
      means.push(nextMeans); scales.push(nextScales);
    }
    const tails = profile.tails.map((tail, regime) => {
      if (k === 1) return 1;
      let stays = 0, exits = 0;
      for (let t = 1; t < inferred.posterior.length; t++) { stays += Math.min(inferred.posterior[t - 1][regime], inferred.posterior[t][regime]); exits += Math.max(0, inferred.posterior[t - 1][regime] - inferred.posterior[t][regime]); }
      return clamp(stays / (stays + exits || 1), .5, .995);
    });
    profile = { ...profile, means, scales, tails };
  }
  const order = profile.means.map((row, index) => ({ index, score: mean(row) })).sort((a, b) => a.score - b.score || a.index - b.index).map(row => row.index);
  return { ...profile, means: order.map(index => profile.means[index]), scales: order.map(index => profile.scales[index]), tails: order.map(index => profile.tails[index]) };
}

export const classifyStudentTHsmm = (data: number[][], profile: HsmmProfile, smooth = false) => infer(data, profile, smooth);

export function adjustedRandIndex(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length < 2) throw new Error('ARI requires equal non-trivial label arrays');
  const choose2 = (n: number) => n * (n - 1) / 2, leftCounts = new Map<number, number>(), rightCounts = new Map<number, number>(), cells = new Map<string, number>();
  for (let i = 0; i < left.length; i++) { leftCounts.set(left[i], (leftCounts.get(left[i]) ?? 0) + 1); rightCounts.set(right[i], (rightCounts.get(right[i]) ?? 0) + 1); const key = `${left[i]}:${right[i]}`; cells.set(key, (cells.get(key) ?? 0) + 1); }
  const pairs = sum([...cells.values()].map(choose2)), leftPairs = sum([...leftCounts.values()].map(choose2)), rightPairs = sum([...rightCounts.values()].map(choose2)), total = choose2(left.length);
  const expected = leftPairs * rightPairs / total, maximum = (leftPairs + rightPairs) / 2;
  return maximum === expected ? 1 : (pairs - expected) / (maximum - expected);
}

export function runLengths(states: readonly number[]) {
  const out: Array<{ state: number; start: number; end: number; length: number }> = [];
  for (let start = 0; start < states.length;) { let end = start + 1; while (end < states.length && states[end] === states[start]) end++; out.push({ state: states[start], start, end: end - 1, length: end - start }); start = end; }
  return out;
}
