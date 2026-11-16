/** Dynamic research/production-parity screen for a BULL 22<=VIX<24 tail. */
import { writeFile } from 'node:fs/promises';
import { buildQqqPcsHistoricalBacktestSpec } from '../../src/lib/engines/analysis/QqqPcsHistoricalBacktest';
import { loadFixture } from '../../src/lib/engines/leveraged-overlay/v2/backtest/fixtures';
import { runWithData, type V2BacktestResult } from '../../src/lib/engines/leveraged-overlay/v2/backtest/runner';
import { rows, summary, type Row } from './pcs-rescue-r5-e56-bull-atr-frontier-20260912';
import type { StrategyParams } from '../../src/lib/engines/leveraged-overlay/types/params';

const NEW_FIXTURE = 'market-2026-09-09-vxn' as const;
const OLD_FIXTURES = ['market-2026-07-31-vxn', 'market-2026-07-03-vxn', 'market-2026-07-21-vxn'] as const;
const START = process.env.PCS_R6_E6_START ?? '2010-01-01';
const END = process.env.PCS_R6_E6_END ?? '2026-09-09';
const CROSS_START = '2011-01-01';
const CROSS_END = '2026-07-31';
const SCOPE = 'selective_quality_v93_risk_ext_vix13_roc20_8_on_e121' as const;

type PairSearchMode = NonNullable<StrategyParams['pcsRescuePairSearchMode']>;
type Arm = { id: string; label: string; mode: PairSearchMode };

const ARMS: readonly Arm[] = [
  { id: 'R6.E5-C', label: '父候选：BULL 20≤VIX<22 + ADX≥20 + ROC20≥0', mode: 'nearest_valid_r6e4_bull_vix22_adx20_roc20_v1' },
  { id: 'R6.E6-A', label: '增加 BULL 22≤VIX<24 + ADX≥10 + ROC20≥0', mode: 'nearest_valid_r6e5_bull_vix24_adx10_roc20_v1' },
  { id: 'R6.E6-B', label: '增加 BULL 22≤VIX<24 + ADX≥15 + ROC20≥0', mode: 'nearest_valid_r6e5_bull_vix24_adx15_roc20_v1' },
  { id: 'R6.E6-C', label: '增加 BULL 22≤VIX<24 + ADX≥20 + ROC20≥0', mode: 'nearest_valid_r6e5_bull_vix24_adx20_roc20_v1' },
];

export function buildR6E6StrategyOverrides(mode: PairSearchMode): Partial<StrategyParams> {
  return {
    enablePCS: true,
    enableEquityBoostPCS: false,
    pcsRescueEnabled: true,
    pcsRescueEntryMode: 'reactive_soft_pool',
    pcsRescueRegimeScope: SCOPE,
    pcsRescueDeltaMode: 'range_smart_quality_v33',
    pcsRescueExtremeDelta: .2425,
    pcsRescueExtremeBaseDelta: .2075,
    pcsRescueExtremeFallbackDelta: .206,
    pcsRescueCalmDelta: .1839,
    pcsRescueNormalDelta: .135,
    pcsRescuePressureDelta: .04,
    pcsRescueWidthPct: .0218,
    pcsRescueExtremeWidthPct: .055,
    pcsRescueTargetDte: 35,
    pcsRescueRiskBudgetNav: .005,
    pcsRescueContractFallbackMode: 'none',
    pcsRescuePairSearchMode: mode,
  };
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
  return { addedCount: added.length, addedWins: added.filter(row => row.pnl > 0).length, addedLosses: added.filter(row => row.pnl < 0).length, addedPnl: round(added.reduce((sum, row) => sum + row.pnl, 0)), addedLossDates: added.filter(row => row.pnl < 0).map(row => row.date), removedCount: removed.length, removedDates: removed.map(row => row.date) };
}

async function runFixture(fixture: string, start: string, end: string) {
  const data = await loadFixture(fixture);
  const results = [];
  for (const arm of ARMS) {
    const spec = buildQqqPcsHistoricalBacktestSpec({ startDate: start, endDate: end, replayVariant: 'v1_2_6', strikeMode: 'delta', exitMode: 'hold_to_expiry' });
    const result = runWithData({ ...spec, config: { ...spec.config, includeTerminalMarkOnly: true }, scenarioOptions: { ...spec.scenarioOptions, canonicalOptionSignalTapeMode: 'skip', trace: true }, strategyOverrides: { ...spec.strategyOverrides, ...buildR6E6StrategyOverrides(arm.mode) } }, data) as V2BacktestResult;
    const resultRows = rows(result);
    results.push({ arm, stats: summary(resultRows), independentMdd: independentMdd(resultRows), rows: resultRows });
  }
  const parent = results[0];
  return { fixture, window: `${start}..${end}`, dataFingerprint: data.fingerprint, parent: { id: parent.arm.id, stats: parent.stats, lossDates: parent.rows.filter(row => row.pnl < 0).map(row => row.date) }, results: results.map(value => ({ id: value.arm.id, label: value.arm.label, mode: value.arm.mode, stats: value.stats, independentMdd: value.independentMdd, mddParity: value.independentMdd === value.stats.mdd, comparisonToParent: compare(parent.rows, value.rows) })) };
}

function statLine(stats: ReturnType<typeof summary>) { return `${stats.n}/${stats.losses}/${stats.wr}%/$${stats.pnl.toFixed(2)}/$${stats.cvar5.toFixed(2)}/$${stats.worst.toFixed(2)}/$${stats.mdd.toFixed(2)}/${stats.holdoutPnl.toFixed(2)}/${stats.rollingMinWr}%/${stats.rollingMaxLosses}/$${stats.rollingWorstMdd.toFixed(2)}`; }

async function main() {
  const screen = await runFixture(NEW_FIXTURE, START, END);
  const cross = [];
  for (const fixture of OLD_FIXTURES) cross.push(await runFixture(fixture, CROSS_START, CROSS_END));
  const output = { status: 'research-only', candidate: 'R6.E6', parent: 'R6.E5-C', dynamicReplay: true, canonicalOptionSignalTape: 'skipped', contract: { scope: SCOPE, replayVariant: 'v1_2_6', execution: 'hold_to_expiry', targetDte: 35, rescueWidthPct: 0.0218, riskBudgetNav: 0.005, eb: 'off', contractFallback: 'none' }, screen, cross: { window: `${CROSS_START}..${CROSS_END}`, results: cross }, decision: 'Advance only the simplest BULL 22<=VIX<24 extension that adds coverage without losses, parent-date replacement, or tail/rolling deterioration.' };
  const out = 'src/lib/engines/leveraged-overlay/backtest/reports/pcs-rescue-r6-e6-vix24-frontier-20260914.json';
  const report = 'src/lib/engines/leveraged-overlay/backtest/reports/pcs-rescue-r6-e6-vix24-frontier-20260914.md';
  await writeFile(out, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  const lines = ['# R6.E6：动态引擎 BULL 22≤VIX<24 覆盖前沿', '', `- 新快照：\`${NEW_FIXTURE}\`；窗口：\`${START}..${END}\`。`, '- 父候选：R6.E5-C；只增加 BULL 22≤VIX<24 尾段，ROC20≥0 保持不变。', '- 运行方式：当前引擎动态计算，跳过 canonical signal tape；窗口仅选择完整行情样本。', '', '## 新快照', '', '| Arm | 规则 | 笔数/亏损/胜率/P&L/CVaR5/最差/MDD | 相对父候选新增/新增胜/新增亏损/增量 P&L | 移除父日期 | 2025+ P&L | 三年滚动最低胜率/最大亏损数/最差 MDD | MDD复核 |', '|---|---|---|---:|---:|---:|---:|---:|', ...screen.results.map(value => `| ${value.id} | ${value.label} | ${statLine(value.stats)} | ${value.comparisonToParent.addedCount}/${value.comparisonToParent.addedWins}/${value.comparisonToParent.addedLosses}/$${value.comparisonToParent.addedPnl.toFixed(2)} | ${value.comparisonToParent.removedCount} | $${value.stats.holdoutPnl.toFixed(2)} | ${value.stats.rollingMinWr}%/${value.stats.rollingMaxLosses}/$${value.stats.rollingWorstMdd.toFixed(2)} | ${value.mddParity ? 'PASS' : 'FAIL'} |`), '', '## 旧快照交叉验证', '', '| Fixture | Arm | 笔数/亏损/胜率/P&L/CVaR5/最差/MDD | 相对父候选新增/新增胜/新增亏损/增量 P&L | 移除父日期 | 2025+ P&L | 三年滚动最低胜率/最大亏损数/最差 MDD | MDD复核 |', '|---|---|---|---:|---:|---:|---:|---:|'];
  for (const fixture of cross) for (const value of fixture.results) lines.push(`| ${fixture.fixture} | ${value.id} | ${statLine(value.stats)} | ${value.comparisonToParent.addedCount}/${value.comparisonToParent.addedWins}/${value.comparisonToParent.addedLosses}/$${value.comparisonToParent.addedPnl.toFixed(2)} | ${value.comparisonToParent.removedCount} | $${value.stats.holdoutPnl.toFixed(2)} | ${value.stats.rollingMinWr}%/${value.stats.rollingMaxLosses}/$${value.stats.rollingWorstMdd.toFixed(2)} | ${value.mddParity ? 'PASS' : 'FAIL'} |`);
  lines.push('', '## 决策', '', '- 新增亏损、父日期替换、MDD复核失败或滚动指标物质恶化的候选淘汰。', '- research-only；未修改默认启用状态或生产下单授权。');
  await writeFile(report, `${lines.join('\n')}\n`, 'utf8');
  console.log(JSON.stringify(output, null, 2));
}

if (import.meta.main) await main();
