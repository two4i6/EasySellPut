import type { EngineResult, EngineStatus, OverlayData, OverlayProposal } from '../types/pipeline';
import type { OverlayAction } from '../types/output';

/** 单日 Overlay 协调的稳定出口；策略信号和成交仍由调用方负责。 */
export type OverlayCoordinationInput = {
  /** 仅用于上游早退等需要覆盖 warning 默认语义的路径。 */
  status?: EngineStatus;
  data: OverlayData;
  warnings: string[];
  blockers: string[];
};

export type OverlayCoordinationOutput = EngineResult<OverlayData>;

/** v1 bridge 与 v2 coordinator 共用的最终输出契约。 */
export function finalizeOverlayCoordination(input: OverlayCoordinationInput): OverlayCoordinationOutput {
  const { status, ...rest } = input;
  return { engineId: 'Overlay', status: status ?? (input.warnings.length > 0 ? 'WARN' : 'PASS'), ...rest };
}

/** 回归比较保留所有金融因子、proposal、警告和状态，仅规范对象键顺序。 */
export function normalizeOverlayCoordination(output: OverlayCoordinationOutput): unknown {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, normalize(entry)]));
    }
    return value;
  };
  return normalize(output);
}

/** Overlay proposal 的唯一汇合点；调用方已完成策略判定，顺序保持 primary 优先。 */
export function coordinateOverlayProposals(primary: OverlayProposal | undefined, supplemental: Array<OverlayProposal | undefined>): OverlayProposal[] {
  return [primary, ...supplemental].filter((proposal): proposal is OverlayProposal => !!proposal);
}

export function findOverlayProposal(proposals: readonly OverlayProposal[], action: OverlayAction): OverlayProposal | undefined {
  return proposals.find((proposal) => proposal.action === action);
}

/** 保持 v1 的同日优先级；只选择动作，不参与任何策略公式或行权价计算。 */
export function resolveOverlayActionPriority(input: {
  collarTriggered: boolean;
  ironCondorTriggered: boolean;
  bearCallSpreadTriggered: boolean;
  bearAction: string;
  bearSkipEligible: boolean;
  callSpreadTriggered: boolean;
  equityBoostTriggered: boolean;
  putSpreadTriggered: boolean;
  /** PCS_RESCUE 只在普通 PCS 未占用时作为独立补位动作。 */
  pcsRescueTriggered?: boolean;
}): OverlayAction {
  if (input.collarTriggered) return 'ADD_COLLAR';
  if (input.ironCondorTriggered) return 'ADD_IRON_CONDOR';
  if (input.bearCallSpreadTriggered) return 'OPEN_BEAR_CALL_SPREAD';
  if (input.bearAction === 'REVIEW_BEAR_CALL_SPREAD') return 'REVIEW_BEAR_CALL_SPREAD';
  if (input.bearAction === 'SKIP_BEAR_CALL_SPREAD' && input.bearSkipEligible) return 'SKIP_BEAR_CALL_SPREAD';
  if (input.callSpreadTriggered) return 'ADD_CALL_SPREAD';
  if (input.equityBoostTriggered) return 'ADD_EQUITY_BOOST_PUT_SPREAD';
  if (input.putSpreadTriggered) return 'ADD_PUT_CREDIT_SPREAD';
  if (input.pcsRescueTriggered) return 'ADD_PCS_RESCUE';
  return 'NONE';
}

/** 输出分类只由协调器按动作映射，避免 Pipeline 重复维护同一白名单。 */
export function overlayTypeForAction(action: OverlayAction): 'coveredOverlay' | 'proxyOverlay' | undefined {
  if (action === 'ADD_COLLAR') return 'coveredOverlay';
  return action === 'ADD_CALL_SPREAD' || action === 'ADD_PUT_CREDIT_SPREAD' || action === 'ADD_IRON_CONDOR' || action === 'OPEN_BEAR_CALL_SPREAD' || action === 'REVIEW_BEAR_CALL_SPREAD' || action === 'ADD_EQUITY_BOOST_PUT_SPREAD' || action === 'ADD_PCS_RESCUE'
    ? 'proxyOverlay'
    : undefined;
}

/** 上游 BLOCK 的 Overlay 例外：保护型 Collar 模式可继续评估，CRISIS 单独保留 Bear 输出。 */
export function resolveOverlayUpstreamGate(input: { hasUpstreamBlock: boolean; collarMode?: string; regime?: string }): 'continue' | 'crisis' | 'skip' {
  if (!input.hasUpstreamBlock || input.collarMode === 'early' || input.collarMode === 'weakening' || input.collarMode === 'always') return 'continue';
  return input.regime === 'CRISIS' ? 'crisis' : 'skip';
}

/** 只在主 proposal 未占用同一策略时构建补充 proposal，顺序与 v1 一致。 */
export function collectSupplementalOverlayProposals(primaryAction: OverlayAction, candidates: Array<{ action: OverlayAction; triggered: boolean; build: () => OverlayProposal | undefined }>): OverlayProposal[] {
  return candidates.flatMap(candidate => candidate.triggered && primaryAction !== candidate.action ? [candidate.build()] : []).filter((proposal): proposal is OverlayProposal => !!proposal);
}

/** 同日 bullish put 结构互斥：新 Equity Boost 优先于传统 PCS。 */
export function resolvePutStrategyPriority(pcsTriggered: boolean, equityBoostTriggered: boolean): { pcsTriggered: boolean; equityBoostTriggered: boolean } {
  return { pcsTriggered: pcsTriggered && !equityBoostTriggered, equityBoostTriggered };
}

/** Collar 的 short-call 只阻断重复卖出上行；纯 Put Spread 保护保留 strict-recovery 例外。 */
export function resolveCollarProxyExclusions(input: { collarTriggered: boolean; allowShortCall: boolean; hasOpenCollar: boolean; hasOpenCollarShortCall: boolean; blocksOtherOverlays?: boolean }) {
  const blocks = input.blocksOtherOverlays !== false;
  return {
    pendingCollarHasShortCall: blocks && input.collarTriggered && input.allowShortCall,
    hasOnlyPutSpreadProtection: input.hasOpenCollar && !input.hasOpenCollarShortCall,
    pendingPutSpreadProtection: blocks && input.collarTriggered && !input.allowShortCall,
  };
}

/** PCS 不能与任意 Collar 保护叠加；non_blocking 研究模式显式解除该约束。 */
export function resolveCollarPutSpreadExclusion(input: { hasOpenCollar: boolean; collarTriggered: boolean; blocksOtherOverlays: boolean }) {
  return {
    hasOpenCollar: input.blocksOtherOverlays && input.hasOpenCollar,
    collarTriggered: input.blocksOtherOverlays && input.collarTriggered,
  };
}

export function mayOpenBearCallSpread(input: { pendingCollarHasShortCall: boolean; hasOpenCollarShortCall: boolean; ironCondorTriggered: boolean; bearAction: string }): boolean {
  return !input.pendingCollarHasShortCall && !input.hasOpenCollarShortCall && !input.ironCondorTriggered && input.bearAction === 'OPEN_BEAR_CALL_SPREAD';
}

/** Bear-CS 的候选与诊断必须使用同一组互斥条件。 */
export function coordinateBearCallSpread(input: { pendingCollarHasShortCall: boolean; hasOpenCollarShortCall: boolean; ironCondorTriggered: boolean; bearAction: string }) {
  const unblocked = !input.pendingCollarHasShortCall && !input.hasOpenCollarShortCall && !input.ironCondorTriggered;
  return {
    triggered: unblocked && input.bearAction === 'OPEN_BEAR_CALL_SPREAD',
    propagateWarnings: unblocked && input.bearAction !== 'SKIP_BEAR_CALL_SPREAD',
  };
}

export function strictRecoveryCallSpreadSkipReasons(input: {
  regimeAllowed: boolean;
  regime: string;
  hasOpenCallSpread: boolean;
  collarShortCall: boolean;
  vix: number;
  vixLowThreshold: number;
  hasPutSpreadProtection: boolean;
  qqqRoc5: number;
  recoveryRoc5: number;
  tqqqRoc20: number;
  recoveryRoc20: number;
}): string[] {
  const reasons: string[] = [];
  if (!input.regimeAllowed) reasons.push(`regime=${input.regime} 不允许`);
  if (input.hasOpenCallSpread) reasons.push('已有 QQQ Call Spread');
  if (input.collarShortCall) reasons.push('已有或待开 Collar Short Call');
  if (input.regime === 'RISK_ON_WEAKENING') {
    if (input.vix >= input.vixLowThreshold) reasons.push(`VIX=${input.vix.toFixed(1)} 未低于 ${input.vixLowThreshold}`);
    if (!input.hasPutSpreadProtection) reasons.push('当前/待开 Collar 不是 Put Spread Protection');
    if (input.qqqRoc5 <= input.recoveryRoc5) reasons.push(`QQQ ROC5=${(input.qqqRoc5 * 100).toFixed(1)}% 未修复`);
    if (input.tqqqRoc20 <= input.recoveryRoc20) reasons.push(`TQQQ ROC20=${(input.tqqqRoc20 * 100).toFixed(1)}% 不足 10%`);
  }
  return reasons;
}
