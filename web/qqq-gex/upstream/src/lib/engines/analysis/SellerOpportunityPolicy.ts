export type SellerOpportunityPolicy = {
  id: string;
  calibrationPassed: boolean;
  validationPassed: boolean;
  /** 人工临时放行；不等同于校准或跨标的验证通过。 */
  manualOpenOverride: boolean;
  calibratedOn: 'QQQ' | null;
  validatedOn: 'SPY' | null;
  eventWatchThreshold: number;
  eventOpenThreshold: number;
  premiumMinimum: number;
  edgeWatchThreshold: number;
  edgeOpenThreshold: number;
  watchSigma: number;
  openSigma: number;
  confirmationSnapshots: 2;
  /** 常态 CSP carry 从近到远只取一个已达标 σ 档；1σ 因更接近现价而更严格。 */
  cspCarry: { coreSigma: 1.5; minimumScore: number; minimumScores: Record<1 | 1.5 | 2 | 2.5, number>; sigmaPriority: readonly [1, 1.5, 2, 2.5] };
  /** PCS 是服务端生产政策；浏览器状态不得改变它。 */
  pcs: { mode: 'off' | 'reactive-v1' };
  intraday: { enabled: boolean };
};

/** 候选中心；主许可 walk-forward 与 SPY 稳健性证据通过前不得 OPEN。 */
export const DEFAULT_SELLER_OPPORTUNITY_POLICY: SellerOpportunityPolicy = {
  id: 'seller-opportunity-candidate-v0-manual-open',
  calibrationPassed: false,
  validationPassed: false,
  manualOpenOverride: true,
  calibratedOn: null,
  validatedOn: null,
  eventWatchThreshold: 40,
  eventOpenThreshold: 60,
  premiumMinimum: 35,
  edgeWatchThreshold: 80,
  edgeOpenThreshold: 120,
  watchSigma: 0.5,
  openSigma: 1,
  confirmationSnapshots: 2,
  cspCarry: { coreSigma: 1.5, minimumScore: 75, minimumScores: { 1: 85, 1.5: 75, 2: 75, 2.5: 75 }, sigmaPriority: [1, 1.5, 2, 2.5] },
  // 冻结的 Discovery / Validation / Holdout manifest 未通过前必须保持 off。
  pcs: { mode: 'off' },
  /**
   * 2026-07-20 已转正：日内层五分量（σ深度/IVR路径/GEX斜率/RSI/VWAP）计入 seller_edge_score，见 route.ts 调用点。
   * ⚠治理备注：此次转正是用户明确指令直接上生产，跳过了原计划（见 IntradayBonusEngine.ts 头部注释）里
   * "影子观测几周、看 bonus 分布/相关性再裁决"的窗口——不是走完整前向观测后才切的。回滚成本为零：
   * 把这个字段改回 false 即为纯空操作，不涉及其它逻辑；若后续几周 bonus 分布显得是噪声，直接回退即可。
   */
  intraday: { enabled: true },
};

/** 仅回测：Git 38/120 原版 OPEN 的对照研究，实时策略始终使用默认政策。 */
export const RESEARCH_OPEN_70_POLICY: SellerOpportunityPolicy = {
  ...DEFAULT_SELLER_OPPORTUNITY_POLICY,
  id: 'seller-opportunity-research-open-70',
  edgeOpenThreshold: 70,
};
