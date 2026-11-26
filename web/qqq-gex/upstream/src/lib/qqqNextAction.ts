import { qqqMarketSession } from './qqqMarketSession';
import type { QqqIntradayDirectionalDecision } from './engines/analysis/QqqIntradayDirectional';
import { qqqDirectionalEvidenceExpired } from './qqqDisplayDecision';

type EntryCheck = {
  dataStatus: string;
  view: { mode: string };
  daily: { eligibility: { value: string } };
  timing: { value: string };
  candidate: { status: string };
};
export type QqqNextActionInput = {
  now: Date;
  historicalDate?: string | null;
  loading?: boolean;
  error?: boolean;
  signal?: QqqIntradayDirectionalDecision | null;
  entries?: readonly { label: string; data: EntryCheck | null }[];
};

export function nextQqqOpen(now: Date): Date {
  const date = qqqMarketSession(now).date;
  for (let offset = 0; offset < 14; offset++) {
    const anchor = new Date(`${date}T14:00:00Z`);
    anchor.setUTCDate(anchor.getUTCDate() + offset);
    const session = qqqMarketSession(anchor);
    const open = new Date(anchor.getTime() + (session.openMinute - session.minute) * 60_000);
    if (session.trading && open.getTime() > now.getTime()) return open;
  }
  throw new Error('No QQQ session found within 14 days');
}

/** Presentation of existing decisions only; never grants eligibility or places orders. */
export function qqqNextAction(input: QqqNextActionInput) {
  const { now, signal } = input;
  const nextBar = new Date((Math.floor(now.getTime() / 120_000) + 1) * 120_000);
  const base = { tone: 'quiet', title: '先等待', instruction: '暂时没有需要处理的新机会。', next: '下一次行情更新后再检查。', deadline: false, checkAt: nextBar as Date | null, levels: [] as { label: string; value: string }[] };
  if (input.historicalDate) return { ...base, title: '正在查看历史', instruction: `这是 ${input.historicalDate} 的回放，不是当前行动提示。`, next: '返回今日，查看现在需要处理的事项。', checkAt: null };
  if (!qqqMarketSession(now).stocksOpen) return { ...base, title: '已休市，等待开盘', instruction: '现在不根据旧快照新增开仓。已有仓位可查看最后估值和到期日。', next: '开盘后，等实时数据更新再检查。', checkAt: nextQqqOpen(now) };
  if (input.error) return { ...base, title: '数据未能更新', instruction: '先等待数据恢复，不按旧提示新增开仓。', next: '刷新页面，确认数据已恢复。', checkAt: null };
  if (input.loading) return { ...base, title: '正在检查最新数据', instruction: '等检查完成，再决定下一步。', next: '结果就绪后，这里会更新。', checkAt: null };
  if (input.entries) {
    if (!input.entries.some(({ data }) => data)) return { ...base, title: '等待有效数据', instruction: '开仓检查尚无可用结果。', next: '等数据就绪后，再复核候选合约。' };
    const ready = input.entries.filter(({ data }) => data?.dataStatus === 'LIVE' && data.view.mode === 'live'
      && data.daily.eligibility.value === 'OPEN' && data.timing.value === 'NOW' && data.candidate.status === 'READY');
    if (ready.length) return { ...base, tone: 'review', title: '复核候选合约', instruction: `${ready.map(entry => entry.label).join('、')}的现有资格、时机和合约检查已通过。请查看开仓检查，核对实时价格与风险。`, next: '条件变化或报价失效时，重新检查。' };
    return { ...base, title: '暂不开新仓', instruction: '目前没有同时通过资格、时机和合约检查的候选。', next: '下一次行情更新后，重新检查开仓条件。' };
  }
  if (!signal || signal.status === 'INSUFFICIENT_DATA' || signal.blockers.length) return { ...base, title: '等待有效数据或条件', instruction: '目前的研究提示不足以支持行动。', next: '等数据恢复且现有条件通过，再看新的提示。' };
  if (qqqDirectionalEvidenceExpired(signal.dataQuality,now.getTime())) return { ...base,title:'行情已过期，继续等待',instruction:'等待行情恢复更新，不沿用上次提示。',next:'有效数据恢复后再复核。' };
  const risk = signal.stage === 'RISK_ELEVATED' || signal.stage === 'STOP_RISK';
  const active = signal.validUntil && Date.parse(signal.validUntil) > now.getTime();
  if (!active && (signal.validUntil || signal.stage === 'TRIGGERED' || risk)) return { ...base, title: '提示已过期，继续等待', instruction: '不要沿用上一次提示。', next: '等待新的有效提示。' };
  const side = signal.riskPlan?.atRisk === 'SP' ? '卖出看跌方向' : signal.riskPlan?.atRisk === 'SC' ? '卖出看涨方向' : signal.direction === 'LONG' ? '卖出看跌方向' : '卖出看涨方向';
  const zone = signal.riskPlan?.triggerZone ?? signal.entryZone;
  const levels = zone ? [{ label: signal.intent === 'RISK_CUE' ? '风险区域' : '观察价格区域', value: `${zone.low.toFixed(2)}–${zone.high.toFixed(2)}` }] : [];
  if (signal.intent === 'RISK_CUE' && risk) return { ...base, tone: 'risk', deadline: true, title: signal.stage === 'STOP_RISK' ? '现在检查持仓风险' : '提高持仓警惕', instruction: `如果你持有${side}的仓位，核对风险区域和自己的退出规则。`, next: '风险是否解除，以后续有效提示为准。', checkAt: new Date(signal.validUntil!), levels };
  if (signal.stage === 'TRIGGERED' && ['ALERT_LONG', 'ALERT_SHORT'].includes(signal.status)) return { ...base, tone: 'review', deadline: true, title: '现在复核方向机会', instruction: `${side}的研究机会已确认。先确认价格仍在计划区域，再到开仓检查复核资格、合约与风险。`, next: '提示到期或价格离开计划区后，等待新的确认。', checkAt: new Date(signal.validUntil!), levels };
  if (signal.stage === 'ARMED') return { ...base, title: '等确认，不急于开仓', instruction: '价格已接近观察区域，收回确认尚未完成。', next: '收到新的确认提示后，再复核候选合约。', levels };
  if (signal.stage === 'SETUP') return { ...base, title: '等价格进入区域', instruction: '方向背景已形成，入场确认尚未完成。', next: '价格进入区域后，继续等待确认提示。', levels };
  return base;
}
