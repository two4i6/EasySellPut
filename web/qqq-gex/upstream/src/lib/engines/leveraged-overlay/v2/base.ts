/**
 * v2 策略与执行层之间的最小共享契约。
 * 决策输入继续由各策略精确声明；这里仅收敛所有策略已经返回的仓位与生命周期结果。
 */
export type OverlayPosition = {
  expiry: string;
  quantity: number;
  underlying?: string;
};

export type OverlayOpenResult<TPosition> = {
  open?: TPosition;
  warning?: string;
};

export type OverlaySettlementResult = {
  cashImpact: number;
  pnl: number;
  note: string;
};

export type OverlayCloseResult = OverlaySettlementResult & {
  costPerShare: number;
};

/** 已计入佣金与冲击后的唯一现金/PnL 入账结果。 */
export type OverlayExecutionEffect = {
  cashDelta: number;
  pnl: number;
};
