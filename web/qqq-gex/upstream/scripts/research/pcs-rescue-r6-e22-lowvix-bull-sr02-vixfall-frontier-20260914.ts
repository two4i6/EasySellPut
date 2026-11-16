/** Dynamic screen for the minimal E21 residual SR02/VIX-falling fill pocket. */
import { writeFile } from 'node:fs/promises';
import { buildQqqPcsHistoricalBacktestSpec } from '../../src/lib/engines/analysis/QqqPcsHistoricalBacktest';
import { loadFixture } from '../../src/lib/engines/leveraged-overlay/v2/backtest/fixtures';
import { runWithData, type V2BacktestResult } from '../../src/lib/engines/leveraged-overlay/v2/backtest/runner';
import { rows, summary, type Row } from './pcs-rescue-r5-e56-bull-atr-frontier-20260912';
import { buildR6E21StrategyOverrides } from './pcs-rescue-r6-e21-lowvix-bull-sr01-vixfall-frontier-20260914';

const NEW_FIXTURE = 'market-2026-09-09-vxn' as const;
const OLD_FIXTURES = ['market-2026-07-31-vxn', 'market-2026-07-03-vxn', 'market-2026-07-21-vxn'] as const;
const START = process.env.PCS_R6_E22_START ?? '2010-01-01';
const END = process.env.PCS_R6_E22_END ?? '2026-09-09';
const CROSS_START = '2011-01-01';
const CROSS_END = '2026-07-31';
const QUALITY = 'roc20_or_sr02_roc5_or_vix22_or_sr01_vix20_or_sr02_vix_lt19_or_current_or_sr02_roc20_lt_m05_or_sr02_adx15_v1' as const;
const PARENT_FILL = 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_v1' as const;
const CHILD_FILL = 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_v1' as const;

type FillFallback = NonNullable<import('../../src/lib/engines/leveraged-overlay/types/params').StrategyParams['pcsRescueFillFallbackMode']>;
const ARMS = [
  { id: 'R6.E21-A', label: '父候选：E20 + 低VIX BULL/SR01/VIX5d下降', fillFallback: PARENT_FILL },
  { id: 'R6.E22-A', label: '增加低VIX BULL/SR02/VIX5d下降≥2%', fillFallback: CHILD_FILL },
] as const satisfies readonly { id: string; label: string; fillFallback: FillFallback }[];

export function buildR6E22StrategyOverrides(fillFallback: FillFallback) {
  return { ...buildR6E21StrategyOverrides(fillFallback), pcsRescueContractFallbackQualityMode: QUALITY };
}

const round = (value: number) => +value.toFixed(2);

function independentMdd(input: readonly Row[]) {
  let equity = 0; let peak = 0; let mdd = 0;
  for (const row of [...input].sort((a, b) => a.date.localeCompare(b.date))) {
    equity += row.pnl; peak = Math.max(peak, equity); mdd = Math.min(mdd, equity - peak);
  }
  return round(mdd);
}

function compare(parent: readonly Row[], candidate: readonly Row[]) {
  const parentDates = new Set(parent.map(row => row.date));
  const candidateDates = new Set(candidate.map(row => row.date));
  const added = candidate.filter(row => !parentDates.has(row.date));
  const removed = parent.filter(row => !candidateDates.has(row.date));
  return {
    addedCount: added.length,
    addedWins: added.filter(row => row.pnl > 0).length,
    addedLosses: added.filter(row => row.pnl < 0).length,
    addedPnl: round(added.reduce((sum, row) => sum + row.pnl, 0)),
    addedLossDates: added.filter(row => row.pnl < 0).map(row => row.date),
    removedCount: removed.length,
    removedDates: removed.map(row => row.date),
  };
}

async function runFixture(fixture: string, start: string, end: string) {
  const data = await loadFixture(fixture);
  const results = [];
  for (const arm of ARMS) {
    const spec = buildQqqPcsHistoricalBacktestSpec({ startDate: start, endDate: end, replayVariant: 'v1_2_6', strikeMode: 'delta', exitMode: 'hold_to_expiry' });
    const result = runWithData({
      ...spec,
      config: { ...spec.config, includeTerminalMarkOnly: true },
      scenarioOptions: { ...spec.scenarioOptions, canonicalOptionSignalTapeMode: 'skip', trace: true },
      strategyOverrides: { ...spec.strategyOverrides, ...buildR6E22StrategyOverrides(arm.fillFallback) },
    }, data) as V2BacktestResult;
    const resultRows = rows(result);
    results.push({ arm, stats: summary(resultRows), independentMdd: independentMdd(resultRows), rows: resultRows });
  }
  const parent = results[0];
  return {
    fixture,
    window: `${start}..${end}`,
    dataFingerprint: data.fingerprint,
    results: results.map(value => ({
      id: value.arm.id,
      label: value.arm.label,
      fillFallback: value.arm.fillFallback,
      stats: value.stats,
      independentMdd: value.independentMdd,
      mddParity: value.independentMdd === value.stats.mdd,
      comparisonToE21: compare(parent.rows, value.rows),
    })),
  };
}

function statLine(stats: ReturnType<typeof summary>) {
  return `${stats.n}/${stats.losses}/${stats.wr}%/$${stats.pnl.toFixed(2)}/$${stats.cvar5.toFixed(2)}/$${stats.worst.toFixed(2)}/$${stats.mdd.toFixed(2)}/${stats.holdoutPnl.toFixed(2)}/${stats.rollingMinWr}%/${stats.rollingMaxLosses}/$${stats.rollingWorstMdd.toFixed(2)}`;
}

async function main() {
  const screen = await runFixture(NEW_FIXTURE, START, END);
  const cross = [];
  for (const fixture of OLD_FIXTURES) cross.push(await runFixture(fixture, CROSS_START, CROSS_END));
  const output = {
    status: 'research-only', candidate: 'R6.E22', parent: 'R6.E21-A', dynamicReplay: true,
    canonicalOptionSignalTape: 'skipped',
    contract: {
      fixture: NEW_FIXTURE, window: `${START}..${END}`, crossWindow: `${CROSS_START}..${CROSS_END}`,
      replayVariant: 'v1_2_6', strikeMode: 'delta', exitMode: 'hold_to_expiry', includeTerminalMarkOnly: true,
      targetDte: 35, rescueWidthPct: 0.0218, riskBudgetNav: 0.005,
      pairMode: 'nearest_valid_r6e5_bull_vix24_adx10_roc20_v1', fallback: 'narrow_updelta_v1',
      fillFallback: 'execution-layer only after first fill failure',
      simplification: 'E21 union plus one SR02/VIX5d<=-2% clause in low-VIX BULL',
    },
    screen, cross,
    decision: 'Advance only if the single SR02/VIX-falling clause adds coverage without losses, parent-date replacement, or tail/rolling deterioration.',
  };
  const out = 'src/lib/engines/leveraged-overlay/backtest/reports/pcs-rescue-r6-e22-lowvix-bull-sr02-vixfall-frontier-20260914.json';
  const report = 'src/lib/engines/leveraged-overlay/backtest/reports/pcs-rescue-r6-e22-lowvix-bull-sr02-vixfall-frontier-20260914.md';
  await writeFile(out, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  const lines = [
    '# R6.E22：低 VIX BULL/SR02/VIX5d下降≥2% fill fallback 前沿', '',
    `- 新快照：\`${NEW_FIXTURE}\`；窗口：\`${START}..${END}\`。`,
    '- 父候选：R6.E21-A；保留 E21 的全部执行 fallback 边界。',
    '- 唯一新增：低 VIX BULL 中允许 SR02 且 VIX5d变化≤-2% 的 fill fallback；不引入日期条件或新的独立状态机。',
    '- 当前引擎动态计算，跳过 canonical signal tape；审计窗口不构成日期白名单。', '',
    '## 新快照', '',
    '| Arm | fill fallback | 笔数/亏损/胜率/P&L/CVaR5/最差/MDD | 相对 E21-A 新增/新增胜/新增亏损/增量 P&L | 移除父日期 | 2025+ P&L | 三年滚动最低胜率/最大亏损数/最差 MDD | MDD复核 |',
    '|---|---|---|---:|---:|---:|---:|---:|',
    ...screen.results.map(value => `| ${value.id} | ${value.fillFallback} | ${statLine(value.stats)} | ${value.comparisonToE21.addedCount}/${value.comparisonToE21.addedWins}/${value.comparisonToE21.addedLosses}/$${value.comparisonToE21.addedPnl.toFixed(2)} | ${value.comparisonToE21.removedCount} | $${value.stats.holdoutPnl.toFixed(2)} | ${value.stats.rollingMinWr}%/${value.stats.rollingMaxLosses}/$${value.stats.rollingWorstMdd.toFixed(2)} | ${value.mddParity ? 'PASS' : 'FAIL'} |`),
    '', '## 旧快照交叉验证', '',
    '| Fixture | Arm | fill fallback | 笔数/亏损/胜率/P&L/CVaR5/最差/MDD | 相对 E21-A 新增/新增胜/新增亏损/增量 P&L | 移除父日期 | 2025+ P&L | 三年滚动最低胜率/最大亏损数/最差 MDD | MDD复核 |',
    '|---|---|---|---:|---:|---:|---:|---:|',
  ];
  for (const fixture of cross) for (const value of fixture.results) lines.push(`| ${fixture.fixture} | ${value.id} | ${value.fillFallback} | ${statLine(value.stats)} | ${value.comparisonToE21.addedCount}/${value.comparisonToE21.addedWins}/${value.comparisonToE21.addedLosses}/$${value.comparisonToE21.addedPnl.toFixed(2)} | ${value.comparisonToE21.removedCount} | $${value.stats.holdoutPnl.toFixed(2)} | ${value.stats.rollingMinWr}%/${value.stats.rollingMaxLosses}/$${value.stats.rollingWorstMdd.toFixed(2)} | ${value.mddParity ? 'PASS' : 'FAIL'} |`);
  lines.push('', '## 决策', '', '- 新增亏损、父日期替换、MDD复核失败或滚动质量物质恶化的 fallback 淘汰。', '- research-only；未修改默认启用状态或生产下单授权。');
  await writeFile(report, `${lines.join('\n')}\n`, 'utf8');
  console.log(JSON.stringify(output, null, 2));
}

if (import.meta.main) await main();
