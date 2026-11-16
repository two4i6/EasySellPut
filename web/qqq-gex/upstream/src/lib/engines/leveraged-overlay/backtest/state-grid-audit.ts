import type { EquityPoint, ForwardReturnProfile, SlowSubregimeDiagnostic, StateGridAudit, StateGridAuditCell } from './types';

const HORIZONS = [1, 5, 20] as const;
const MIN_DAYS = 20;

type Row = {
  point: EquityPoint;
  sr: 'SR01' | 'SR02' | 'UNKNOWN';
  posteriorBucket: StateGridAuditCell['posteriorBucket'];
};

const median = (values: number[]) => {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
};

function profile(values: number[]): ForwardReturnProfile {
  if (!values.length) return { samples: 0, meanPct: 0, medianPct: 0, winRate: 0, p10Pct: 0 };
  const ordered = [...values].sort((a, b) => a - b);
  return {
    samples: values.length,
    meanPct: values.reduce((sum, value) => sum + value, 0) / values.length,
    medianPct: median(values),
    winRate: values.filter(value => value > 0).length / values.length,
    p10Pct: ordered[Math.floor((ordered.length - 1) * .1)]!,
  };
}

function srState(diagnostic: SlowSubregimeDiagnostic | undefined): Pick<Row, 'sr' | 'posteriorBucket'> {
  const factors = diagnostic?.factors;
  const sr = factors?.slow_subregime_state?.value;
  if (sr !== 'SR01' && sr !== 'SR02') return { sr: 'UNKNOWN', posteriorBucket: 'unknown' };
  const posterior = factors?.[sr === 'SR01' ? 'slow_subregime_posterior_sr01' : 'slow_subregime_posterior_sr02']?.value;
  if (typeof posterior !== 'number') return { sr, posteriorBucket: 'unknown' };
  return { sr, posteriorBucket: posterior >= .9 ? 'p90+' : posterior >= .5 ? 'p50-89' : 'p<50' };
}

/** 仅聚合既有回测状态与收盘价，避免新增第二条 policy / decision 链。 */
export function buildStateGridAudit(equityCurve: EquityPoint[], diagnostics: SlowSubregimeDiagnostic[] | undefined): StateGridAudit | undefined {
  if (!equityCurve.length || new Set(equityCurve.map(point => point.date.slice(0, 10))).size !== equityCurve.length) return undefined;
  const diagnosticByDate = new Map((diagnostics ?? []).map(item => [item.date.slice(0, 10), item]));
  const rows: Row[] = equityCurve.map(point => ({ point, ...srState(diagnosticByDate.get(point.date.slice(0, 10))) }));
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const phase = row.point.marketContext?.macroRegime === 'SLOW_BULL' || row.point.marketContext?.macroRegime === 'SLOW_BEAR' ? row.point.marketContext.macroRegime : 'UNKNOWN';
    const key = [row.point.regime, row.point.crisisPhase ?? 'NONE', phase, row.sr, row.posteriorBucket].join('|');
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const cells = Array.from(groups, ([key, group]): StateGridAuditCell => {
    const [fastRegime, crisisPhase, w7Phase, slowSubregime, posteriorBucket] = key.split('|') as [StateGridAuditCell['fastRegime'], StateGridAuditCell['crisisPhase'], StateGridAuditCell['w7Phase'], StateGridAuditCell['slowSubregime'], StateGridAuditCell['posteriorBucket']];
    const policies = new Map<string, number>();
    const returns = new Map(HORIZONS.map(horizon => [horizon, { qqq: [] as number[], leveraged: [] as number[] }]));
    for (const row of group) {
      policies.set(row.point.stockPolicyId ?? 'CURRENT', (policies.get(row.point.stockPolicyId ?? 'CURRENT') ?? 0) + 1);
      const index = rows.indexOf(row);
      for (const horizon of HORIZONS) {
        const future = rows[index + horizon]?.point;
        if (!future || row.point.qqqPrice == null || row.point.qqqPrice <= 0 || future.qqqPrice == null || future.qqqPrice <= 0 || row.point.leveragedPrice == null || row.point.leveragedPrice <= 0 || future.leveragedPrice == null || future.leveragedPrice <= 0) continue;
        returns.get(horizon)!.qqq.push(future.qqqPrice / row.point.qqqPrice - 1);
        returns.get(horizon)!.leveraged.push(future.leveragedPrice / row.point.leveragedPrice - 1);
      }
    }
    return {
      key, fastRegime, crisisPhase, w7Phase, slowSubregime, posteriorBucket,
      days: group.length, share: group.length / rows.length,
      avgTargetTqqqPct: group.reduce((sum, row) => sum + (row.point.targetTqqqPct ?? 0), 0) / group.length,
      stockPolicies: Array.from(policies, ([id, days]) => ({ id, days })).sort((a, b) => b.days - a.days),
      forward: Object.fromEntries(HORIZONS.map(horizon => [horizon, { qqq: profile(returns.get(horizon)!.qqq), leveraged: profile(returns.get(horizon)!.leveraged) }])) as StateGridAuditCell['forward'],
      discountedStrong: false,
    };
  });
  const targetMedian = median(cells.map(cell => cell.avgTargetTqqqPct));
  const qqq20Median = median(cells.filter(cell => cell.forward[20].qqq.samples >= MIN_DAYS).map(cell => cell.forward[20].qqq.medianPct));
  for (const cell of cells) {
    const qqq = cell.forward[20].qqq;
    cell.discountedStrong = cell.days >= MIN_DAYS && qqq.samples >= MIN_DAYS && cell.avgTargetTqqqPct < targetMedian && qqq.medianPct > qqq20Median && qqq.winRate >= .6;
  }
  return { minDays: MIN_DAYS, totalDays: rows.length, cells: cells.sort((a, b) => Number(b.discountedStrong) - Number(a.discountedStrong) || b.days - a.days) };
}
