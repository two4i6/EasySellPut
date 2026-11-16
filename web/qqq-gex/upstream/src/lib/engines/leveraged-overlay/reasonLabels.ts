export const REASON_LABELS = {
  target_rebalance: '目标调仓',
  risk_reduction: '风险降仓',
  risk_recovery: '风险恢复',
  liquidity_rebalance: '流动性调仓',
  upstream_block: '上游风控阻断',
  intraday_derisk: '日内避险',
  hard_risk_cap: '硬约束上限',
  trend_discount: '趋势折价',
  regime_adjustment: '按市场状态调仓',
  vol_target_resize: '按波动率调仓',
  iron_condor_open: 'Iron Condor 区间收益',
  bear_call_spread_open: 'Bear Call Spread 熊市反弹',
  call_credit_spread_open: 'Call Spread 低波超买',
  collar_overheat_open: 'Collar 过热保护',
  collar_drawdown_open: 'Collar 回撤保护',
  collar_vix_spike_open: 'Collar VIX 突刺保护',
  collar_weakening_open: 'Collar 转弱保护',
  collar_alternative_open: 'Collar 替代卖出',
  collar_protection_open: 'Collar 主动保护',
  profit_take: '止盈',
  stop_loss: '止损',
  range_breach: '区间突破',
  delta_stop: 'Delta/方向止损',
  dte_exit: '临近到期',
  other: '其他退出',
  vix_normalized: 'VIX 回落',
  recovery_exit: '回撤修复',
  final_forced_close: '回测结束强平',
  expiry_settlement: '到期结算',
  unknown: '未知',
} as const;

export type ExecutionReasonKey = keyof typeof REASON_LABELS;

export function reasonLabel(key: string, fallback?: string): string {
  return REASON_LABELS[key as ExecutionReasonKey] ?? fallback ?? key;
}
