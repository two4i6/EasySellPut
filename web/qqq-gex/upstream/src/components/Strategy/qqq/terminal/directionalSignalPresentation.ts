import type { QqqIntradayDirectionalDecision } from '@/lib/engines/analysis/QqqIntradayDirectional';
import type { QqqIntradayDirectionalReplaySignal } from '@/lib/engines/analysis/QqqIntradayDirectionalReplay';
import { qqqMarketSession } from '@/lib/qqqMarketSession';
import { qqqDirectionalEvidenceExpired } from '@/lib/qqqDisplayDecision';

type Signal = QqqIntradayDirectionalDecision | QqqIntradayDirectionalReplaySignal;
export function directionalSignalPresentation(signal: Signal | null, now: number, historical = false) {
  const idle = { title: '暂无新提示', next: '继续等待，出现确认机会或持仓风险时会更新这里。', tone: 'neutral', actionable: false, steps: [] as string[] };
  if (!signal) return { ...idle, title: '等待数据', next: '行情就绪后会自动检查，暂时无需操作。' };
  if ('status' in signal && (signal.status === 'INSUFFICIENT_DATA' || signal.blockers.length)) return { ...idle, title: '数据或条件不足', next: '等待数据更新和条件通过，再复核新的提示。' };
  if (!historical && 'dataQuality' in signal && qqqDirectionalEvidenceExpired(signal.dataQuality,now)) return {...idle,title:'行情已过期',next:'等待行情恢复更新，再复核新的提示。'};
  if (!signal.stage) return idle;
  if (!historical && !qqqMarketSession(new Date(now)).stocksOpen) return { ...idle, title: '当前非正常交易时段', next: '等待下一交易时段更新，不沿用上次提示。' };
  const side = signal.intent === 'RISK_CUE' ? signal.riskPlan?.atRisk ?? (signal.direction === 'LONG' ? 'SC' : signal.direction === 'SHORT' ? 'SP' : null) : signal.direction === 'LONG' ? 'SP' : signal.direction === 'SHORT' ? 'SC' : null;
  const name = side === 'SP' ? '卖出看跌期权' : side === 'SC' ? '卖出看涨期权' : '对应方向';
  const risk = signal.stage === 'RISK_ELEVATED' || signal.stage === 'STOP_RISK';
  if (!historical && signal.validUntil && Date.parse(signal.validUntil) <= now) return { ...idle, title: '上次提示已过期', next: '等待新的有效提示，不沿用上次的价格计划。' };
  if (!historical && (risk || signal.stage === 'TRIGGERED') && (!signal.validUntil || Date.parse(signal.validUntil) <= now)) return { ...idle, title: '上次提示已过期', next: '等待新的有效提示，不沿用上次的价格计划。' };
  if (risk) return { title: signal.stage === 'STOP_RISK' ? '检查持仓风险' : '持仓风险升高', next: `如果持有${name}的仓位，${signal.stage === 'STOP_RISK' ? '核对风险价格与自己的退出规则。' : '关注下方风险价格，等待进一步确认。'}`, tone: signal.stage === 'STOP_RISK' ? 'danger' : 'warning', actionable: true, steps: ['风险升高', '风险确认'] };
  const steps = ['形成观察区', '等待价格确认', '复核机会'];
  if (signal.stage === 'TRIGGERED') return { title: `${name} · 待复核`, next: '先确认价格仍在观察区，再到开仓检查核对合约、报价和风险。', tone: 'accent', actionable: true, steps };
  if (signal.stage === 'ARMED') return { title: '价格已接近，等待确认', next: '等待价格收回关键区域；确认前先不开新仓。', tone: 'warning', actionable: true, steps };
  if (signal.stage === 'SETUP') return { title: '等待价格进入观察区', next: `${name}方向形成观察条件，价格进入区域后还需确认。`, tone: 'neutral', actionable: true, steps };
  return idle;
}
