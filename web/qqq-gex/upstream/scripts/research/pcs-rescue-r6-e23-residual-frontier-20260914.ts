/** Dynamic screen for two minimal E22 residual fill-fallback branches. */
import { writeFile } from 'node:fs/promises';
import { buildQqqPcsHistoricalBacktestSpec } from '../../src/lib/engines/analysis/QqqPcsHistoricalBacktest';
import { loadFixture } from '../../src/lib/engines/leveraged-overlay/v2/backtest/fixtures';
import { runWithData, type V2BacktestResult } from '../../src/lib/engines/leveraged-overlay/v2/backtest/runner';
import { rows, summary, type Row } from './pcs-rescue-r5-e56-bull-atr-frontier-20260912';
import { buildR6E22StrategyOverrides } from './pcs-rescue-r6-e22-lowvix-bull-sr02-vixfall-frontier-20260914';
import type { StrategyParams } from '../../src/lib/engines/leveraged-overlay/types/params';

const NEW_FIXTURE = 'market-2026-09-09-vxn' as const;
const OLD_FIXTURES = ['market-2026-07-31-vxn', 'market-2026-07-03-vxn', 'market-2026-07-21-vxn'] as const;
const START = process.env.PCS_R6_E23_START ?? '2010-01-01';
const END = process.env.PCS_R6_E23_END ?? '2026-09-09';
const CROSS_START = '2011-01-01';
const CROSS_END = '2026-07-31';
const PARENT_FILL = 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_v1' as const;
const RISK_EXT_FILL = 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_or_riskext_vix16_v1' as const;
const BULL_LOW_FILL = 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_or_bull_sr02_vixlt12_v1' as const;
const COMBINED_FILL = 'next_chain_delta_core_bull_vix16_or_lowvix_bull_adxlt15_or_sr01_vixfall_or_sr02_vixfall_m02_or_riskext_vix16_or_bull_sr02_vixlt12_v1' as const;

type FillFallback = NonNullable<StrategyParams['pcsRescueFillFallbackMode']>;
const ARMS = [
  { id: 'R6.E22-A', label: '父候选：E22', fillFallback: PARENT_FILL },
  { id: 'R6.E23-A', label: 'E22 + RISK_ON_EXTENDED/VIX≥16', fillFallback: RISK_EXT_FILL },
  { id: 'R6.E23-B', label: 'E22 + BULL/SR02/VIX<12', fillFallback: BULL_LOW_FILL },
  { id: 'R6.E23-C', label: 'E23-A + E23-B（最小 OR 合并）', fillFallback: COMBINED_FILL },
] as const satisfies readonly { id: string; label: string; fillFallback: FillFallback }[];

export function buildR6E23StrategyOverrides(fillFallback: FillFallback) {
  return { ...buildR6E22StrategyOverrides(fillFallback) };
}

const round = (value: number) => +value.toFixed(2);

function independentMdd(input: readonly Row[]) {
  let equity = 0; let peak = 0; let mdd = 0;
  for (const row of [...input].sort((a, b) => a.date.localeCompare(b.date))) { equity += row.pnl; peak = Math.max(peak, equity); mdd = Math.min(mdd, equity - peak); }
  return round(mdd);
}

function compare(parent: readonly Row[], candidate: readonly Row[]) {
  const p = new Set(parent.map(row => row.date)); const c = new Set(candidate.map(row => row.date));
  const added = candidate.filter(row => !p.has(row.date)); const removed = parent.filter(row => !c.has(row.date));
  return { addedCount: added.length, addedWins: added.filter(row => row.pnl > 0).length, addedLosses: added.filter(row => row.pnl < 0).length, addedPnl: round(added.reduce((sum, row) => sum + row.pnl, 0)), addedLossDates: added.filter(row => row.pnl < 0).map(row => row.date), removedCount: removed.length, removedDates: removed.map(row => row.date) };
}

async function runFixture(fixture: string, start: string, end: string) {
  const data = await loadFixture(fixture); const results = [];
  for (const arm of ARMS) {
    const spec = buildQqqPcsHistoricalBacktestSpec({ startDate: start, endDate: end, replayVariant: 'v1_2_6', strikeMode: 'delta', exitMode: 'hold_to_expiry' });
    const result = runWithData({ ...spec, config: { ...spec.config, includeTerminalMarkOnly: true }, scenarioOptions: { ...spec.scenarioOptions, canonicalOptionSignalTapeMode: 'skip', trace: true }, strategyOverrides: { ...spec.strategyOverrides, ...buildR6E23StrategyOverrides(arm.fillFallback) } }, data) as V2BacktestResult;
    const resultRows = rows(result); results.push({ arm, stats: summary(resultRows), independentMdd: independentMdd(resultRows), rows: resultRows });
  }
  const parent = results[0];
  return { fixture, window: `${start}..${end}`, dataFingerprint: data.fingerprint, results: results.map(value => ({ id: value.arm.id, label: value.arm.label, fillFallback: value.arm.fillFallback, stats: value.stats, independentMdd: value.independentMdd, mddParity: value.independentMdd === value.stats.mdd, comparisonToE22: compare(parent.rows, value.rows) })) };
}

function statLine(stats: ReturnType<typeof summary>) { return `${stats.n}/${stats.losses}/${stats.wr}%/$${stats.pnl.toFixed(2)}/$${stats.cvar5.toFixed(2)}/$${stats.worst.toFixed(2)}/$${stats.mdd.toFixed(2)}/${stats.holdoutPnl.toFixed(2)}/${stats.rollingMinWr}%/${stats.rollingMaxLosses}/$${stats.rollingWorstMdd.toFixed(2)}`; }

async function main() {
  const screen = await runFixture(NEW_FIXTURE, START, END); const cross = [];
  for (const fixture of OLD_FIXTURES) cross.push(await runFixture(fixture, CROSS_START, CROSS_END));
  const output = { status: 'research-only', candidate: 'R6.E23-screen', parent: 'R6.E22-A', dynamicReplay: true, canonicalOptionSignalTape: 'skipped', contract: { replayVariant: 'v1_2_6', strikeMode: 'delta', exitMode: 'hold_to_expiry', includeTerminalMarkOnly: true, targetDte: 35, rescueWidthPct: 0.0218, riskBudgetNav: 0.005, fillFallback: 'execution-layer only after first fill failure', candidates: ['RISK_ON_EXTENDED && VIX>=16', 'BULL && SR02 && VIX<12', 'minimal OR union of the two'] }, screen, cross: { window: `${CROSS_START}..${CROSS_END}`, results: cross }, decision: 'Advance only the smallest union that adds coverage without losses, parent-date replacement, or tail/rolling deterioration.' };
  const out = 'src/lib/engines/leveraged-overlay/backtest/reports/pcs-rescue-r6-e23-residual-frontier-20260914.json'; const report = 'src/lib/engines/leveraged-overlay/backtest/reports/pcs-rescue-r6-e23-residual-frontier-20260914.md';
  await writeFile(out, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  const lines = ['# R6.E23：E22 residual 最小分支前沿', '', `- 新快照：\`${NEW_FIXTURE}\`；窗口：\`${START}..${END}\`。`, '- 父候选：R6.E22-A；每个子候选只新增一个 OR 分支，不把两个分支合并。', '- 当前引擎动态计算，跳过 canonical signal tape；审计窗口不构成日期白名单。', '', '## 新快照', '', '| Arm | fill fallback | 笔数/亏损/胜率/P&L/CVaR5/最差/MDD | 相对 E22-A 新增/新增胜/新增亏损/增量 P&L | 移除父日期 | 2025+ P&L | 三年滚动最低胜率/最大亏损数/最差 MDD | MDD复核 |', '|---|---|---|---:|---:|---:|---:|---:|', ...screen.results.map(value => `| ${value.id} | ${value.fillFallback} | ${statLine(value.stats)} | ${value.comparisonToE22.addedCount}/${value.comparisonToE22.addedWins}/${value.comparisonToE22.addedLosses}/$${value.comparisonToE22.addedPnl.toFixed(2)} | ${value.comparisonToE22.removedCount} | $${value.stats.holdoutPnl.toFixed(2)} | ${value.stats.rollingMinWr}%/${value.stats.rollingMaxLosses}/$${value.stats.rollingWorstMdd.toFixed(2)} | ${value.mddParity ? 'PASS' : 'FAIL'} |`), '', '## 旧快照交叉验证', '', '| Fixture | Arm | fill fallback | 笔数/亏损/胜率/P&L/CVaR5/最差/MDD | 相对 E22-A 新增/新增胜/新增亏损/增量 P&L | 移除父日期 | 2025+ P&L | 三年滚动最低胜率/最大亏损数/最差 MDD | MDD复核 |', '|---|---|---|---:|---:|---:|---:|---:|'];
  for (const fixture of cross) for (const value of fixture.results) lines.push(`| ${fixture.fixture} | ${value.id} | ${value.fillFallback} | ${statLine(value.stats)} | ${value.comparisonToE22.addedCount}/${value.comparisonToE22.addedWins}/${value.comparisonToE22.addedLosses}/$${value.comparisonToE22.addedPnl.toFixed(2)} | ${value.comparisonToE22.removedCount} | $${value.stats.holdoutPnl.toFixed(2)} | ${value.stats.rollingMinWr}%/${value.stats.rollingMaxLosses}/${value.stats.rollingWorstMdd.toFixed(2)} | ${value.mddParity ? 'PASS' : 'FAIL'} |`);
  lines.push('', '## 决策', '', '- 仅保留同时满足新增覆盖、零新增亏损、零父日期移除、MDD复核通过且 rolling/tail 不恶化的最简分支。', '- research-only；未修改默认启用状态或生产下单授权。');
  await writeFile(report, `${lines.join('\n')}\n`, 'utf8'); console.log(JSON.stringify(output, null, 2));
}

if (import.meta.main) await main();
