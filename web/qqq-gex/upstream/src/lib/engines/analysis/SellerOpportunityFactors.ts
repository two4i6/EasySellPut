import { createDerivedFactor, createRawFactor, fallbackFactor } from '@/lib/factor';
import type { FactorMap, FinancialFactor } from '@/types/factor';
import type { IVPoint } from '@/types/ivCurve';
import type { SellerOpportunityLifecyclePoint } from '@/types/sellerOpportunity';
import { bucketFor, type SellerStat, type SellerStats } from './SellerStatsEngine';
import { sellerPutNoBreachFactorId } from './SellerEdgeScoreEngine';
import { DEFAULT_SELLER_OPPORTUNITY_POLICY } from './SellerOpportunityPolicy';
import { DEFAULT_CSP_SETTINGS } from '../../../store/useCSPStore';
import { evaluateReactivePcsTiming } from './PcsReactiveRule';

const HISTORY_ID = 'seller_history_as_of';
const CARRY_SIGMAS = [1, 1.5, 2, 2.5] as const;
const carryKey = (sigma: number) => String(sigma).replace('.', '_');

/** 与回测 PCS reactive 时机共用的纯因果门槛；缺任一输入即 fail closed。 */
export function addReactivePcsProductionFactors(base: FactorMap, mode: 'off' | 'reactive-v1'): FactorMap {
  const vix = base.vix_price;
  const term = base.vix_term_ratio;
  const regime = base.pcs_market_regime;
  const account = base.account_open_pcs_count;
  const symbol = base.symbol;
  const valid = (factor: FinancialFactor<unknown> | undefined) => !!factor && factor.confidence > 0;
  const source = { ...base };
  const gate = (id: string, value: boolean, inputs: string[], reason: string) => valid(symbol) && inputs.every(input => valid(source[input]))
    ? createDerivedFactor(value, inputs.map(factorId => ({ factorId, weight: 1 / inputs.length })), source)
    : fallbackFactor(false, reason);
  const isQqq = gate('pcs_symbol_qqq', String(symbol?.value) === 'QQQ', ['symbol'], 'symbol 不可用');
  const vixRange = gate('pcs_vix_14_28', typeof vix?.value === 'number' && vix.value >= 14 && vix.value <= 28, ['vix_price'], 'VIX 不可用');
  const riskOn = gate(
    'pcs_risk_on',
    evaluateReactivePcsTiming({
      symbol: 'QQQ',
      regime: String(regime?.value),
      vix: typeof vix?.value === 'number' ? vix.value : NaN,
      termRatio: typeof term?.value === 'number' ? term.value : Number.NaN,
    }).eligible,
    ['pcs_market_regime', 'vix_price', 'vix_term_ratio'],
    '风险偏好时机条件不可用',
  );
  const noCrisis = gate('pcs_no_crisis', String(regime?.value) !== 'CRISIS', ['pcs_market_regime'], '市场状态不可用');
  const noBackwardation = gate('pcs_no_backwardation', typeof term?.value === 'number' && term.value < 1, ['vix_term_ratio'], '期限结构不可用');
  const capacity = gate('pcs_account_capacity', account?.value === 0, ['account_open_pcs_count'], '账户 PCS 持仓不可用');
  const inputs = ['pcs_symbol_qqq', 'pcs_vix_14_28', 'pcs_risk_on', 'pcs_no_crisis', 'pcs_no_backwardation', 'pcs_account_capacity'];
  const gates: FactorMap = {
    pcs_symbol_qqq: isQqq,
    pcs_vix_14_28: vixRange,
    pcs_risk_on: riskOn,
    pcs_no_crisis: noCrisis,
    pcs_no_backwardation: noBackwardation,
    pcs_account_capacity: capacity,
  };
  const allPass = mode === 'reactive-v1' && inputs.every(id => gates[id].confidence > 0 && gates[id].value === true);
  return {
    ...base,
    ...gates,
    pcs_policy_enabled: { value: mode === 'reactive-v1', confidence: 7, source: { type: 'manual', description: '服务端 PCS production policy' } },
    pcs_reactive_eligible: createDerivedFactor(allPass, [...inputs, 'pcs_policy_enabled'].map(factorId => ({ factorId, weight: 1 / (inputs.length + 1) })), { ...base, ...gates, pcs_policy_enabled: { value: mode === 'reactive-v1', confidence: 7, source: { type: 'manual', description: '服务端 PCS production policy' } } }),
  };
}

function statistic(value: SellerStat, factors: FactorMap): FinancialFactor<number> {
  if (value.n < 8 || value.value === null) return fallbackFactor(0, `${value.formulaKey} 样本不足（n=${value.n}）`);
  const derived = createDerivedFactor(value.value, [{ factorId: HISTORY_ID, weight: 1 }], factors);
  return { ...derived, confidence: Math.min(derived.confidence, value.confidence) };
}

function historyDerived(value: number | boolean, factors: FactorMap): FinancialFactor<number | boolean> {
  return Number.isFinite(typeof value === 'number' ? value : 1)
    ? createDerivedFactor(value, [{ factorId: HISTORY_ID, weight: 1 }], factors)
    : fallbackFactor(value, '历史行情派生值无效');
}

/** 将 SellerStats 的金融数值写回唯一的扁平 FactorMap；不改变任何统计公式。 */
export function addSellerOpportunityFactors(base: FactorMap, stats: SellerStats, historyAsOf: string, previousClose?: number): FactorMap {
  // 缓存可能仍是新增字段前的 SellerStats；锚定统计缺失时仅展示为不可用，不能阻断主分析。
  const unavailableAnchoredStat = (formulaKey: string): SellerStat => ({ value: null, n: 0, windowDays: 0, formulaKey, confidence: 0 });
  const anchored = stats.anchoredManageability;
  const factors: FactorMap = {
    ...base,
    [HISTORY_ID]: createRawFactor(historyAsOf, value => !Number.isNaN(Date.parse(value)), 'Yahoo'),
    seller_previous_close: createRawFactor(previousClose ?? 0, value => Number.isFinite(value) && value > 0, 'Yahoo', undefined, 0),
    seller_policy_version: { value: DEFAULT_SELLER_OPPORTUNITY_POLICY.id, confidence: 7, source: { type: 'manual', description: '候选政策版本；校准证据状态见 policy' } },
  };
  const derived: FactorMap = {
    seller_sigma_20: historyDerived(stats.todayMove.sigma20, factors),
    seller_today_log_return: historyDerived(stats.todayMove.returnPct, factors),
    seller_prior_4d_log_return: stats.prior4dReturnPct === null
      ? fallbackFactor(0, '今天之前的 4 日历史不足')
      : historyDerived(stats.prior4dReturnPct, factors),
    seller_prior_4d_sigma: stats.prior4dSigma === null
      ? fallbackFactor(0, '今天之前的 4 日平静度不可用')
      : historyDerived(stats.prior4dSigma, factors),
    seller_downside_z_1d: historyDerived(stats.downsideShock.oneDay, factors),
    seller_downside_z_3d: historyDerived(stats.downsideShock.threeDay, factors),
    seller_downside_z_5d: historyDerived(stats.downsideShock.fiveDay, factors),
    seller_distance_from_37d_high: historyDerived(stats.distanceFromHigh.distPct37d, factors),
    seller_distance_from_52w_high: historyDerived(stats.distanceFromHigh.distPct52w, factors),
    seller_sweet_spot_active: historyDerived(
      !!stats.swingSweetSpot.band
        && stats.swingSweetSpot.currentDistPct >= stats.swingSweetSpot.band[0]
        && stats.swingSweetSpot.currentDistPct <= stats.swingSweetSpot.band[1]
        && (stats.swingSweetSpot.bounceProb10d.value ?? 0) >= .6,
      factors,
    ),
    seller_stat_manage_recover_5d: statistic(stats.manageability.recover5d, factors),
    seller_stat_manage_half_retrace_10d: statistic(stats.manageability.halfRetrace10d, factors),
    seller_stat_manage_repair_success_15d: statistic(stats.manageability.repairSuccess, factors),
    seller_stat_manage_continue_drop_5d: statistic(stats.manageability.continueDrop5d, factors),
    seller_stat_manage_worst_5d_drop: statistic(stats.manageability.worstCase5dDropPct, factors),
    seller_stat_manage_median_repair_days: statistic(stats.manageability.medianRepairDays, factors),
    seller_stat_manage_anchored_recover_5d: statistic(anchored?.recover5d ?? unavailableAnchoredStat('manageAnchoredRecover5d'), factors),
    seller_stat_manage_anchored_half_retrace_10d: statistic(anchored?.halfRetrace10d ?? unavailableAnchoredStat('manageAnchoredHalfRetrace10d'), factors),
    seller_stat_manage_anchored_repair_success_15d: statistic(anchored?.repairSuccess ?? unavailableAnchoredStat('manageAnchoredRepairSuccess'), factors),
    seller_stat_manage_anchored_continue_drop_5d: statistic(anchored?.continueDrop5d ?? unavailableAnchoredStat('manageAnchoredContinueDrop5d'), factors),
    seller_stat_manage_anchored_worst_5d_drop: statistic(anchored?.worstCase5dDropPct ?? unavailableAnchoredStat('manageAnchoredWorstCase5dDropPct'), factors),
    seller_stat_manage_anchored_median_repair_days: statistic(anchored?.medianRepairDays ?? unavailableAnchoredStat('manageAnchoredMedianRepairDays'), factors),
    seller_stat_swing_bounce_10d: statistic(stats.swingSweetSpot.bounceProb10d, factors),
    seller_stat_swing_median_bounce: statistic(stats.swingSweetSpot.medianBounceMagPct, factors),
  };
  const currentShock = Math.max(stats.downsideShock.oneDay, stats.downsideShock.threeDay, stats.downsideShock.fiveDay);
  const currentBucket = bucketFor(currentShock);
  derived.seller_current_downside_bucket = currentBucket === null
    ? fallbackFactor(null, '当前无 ≥1σ 下行桶')
    : createDerivedFactor(currentBucket, [
      { factorId: 'seller_downside_z_1d', weight: 1 / 3 }, { factorId: 'seller_downside_z_3d', weight: 1 / 3 }, { factorId: 'seller_downside_z_5d', weight: 1 / 3 },
    ], { ...factors, ...derived });
  const anchoredStatIds: Record<string, string> = {
    recover5d: 'seller_stat_manage_anchored_recover_5d', halfRetrace10d: 'seller_stat_manage_anchored_half_retrace_10d',
    repairSuccess: 'seller_stat_manage_anchored_repair_success_15d', continueDrop5d: 'seller_stat_manage_anchored_continue_drop_5d',
    worstCase5dDropPct: 'seller_stat_manage_anchored_worst_5d_drop', medianRepairDays: 'seller_stat_manage_anchored_median_repair_days',
  };
  for (const [key, id] of Object.entries(anchoredStatIds)) {
    const statValue = (anchored?.[key as keyof NonNullable<typeof anchored>] ?? unavailableAnchoredStat(key)) as SellerStat;
    derived[`${id}_n`] = createDerivedFactor(statValue.n, [{ factorId: HISTORY_ID, weight: 1 }], factors);
    derived[`${id}_window_days`] = createDerivedFactor(statValue.windowDays, [{ factorId: HISTORY_ID, weight: 1 }], factors);
    derived[`${id}_formula_key`] = createDerivedFactor(statValue.formulaKey, [{ factorId: HISTORY_ID, weight: 1 }], factors);
  }
  for (const row of stats.sellPutNoBreach) derived[sellerPutNoBreachFactorId(row.bucket)] = statistic(row, factors);
  for (const row of stats.sellPutNextDayNoLoss) derived[`seller_stat_put_next_day_no_loss_${row.bucket.replace(/[^a-z0-9]+/gi, '_')}`] = statistic(row, factors);
  for (const row of stats.sellPutNextDayRebound) derived[`seller_stat_put_next_day_rebound_${row.bucket.replace(/[^a-z0-9]+/gi, '_')}`] = statistic(row, factors);
  for (const row of stats.sellPutNoLoss.sameDayFade) derived[`seller_stat_put_same_day_fade_${row.bucket.replace(/[^a-z0-9]+/gi, '_')}`] = statistic(row, factors);
  for (const row of stats.sellPutNoLoss.week) derived[`seller_stat_put_week_no_loss_${row.bucket.replace(/[^a-z0-9]+/gi, '_')}`] = statistic(row, factors);
  for (const row of stats.strikeSurvival) {
    const sigmaDistanceId = `seller_strike_sigma_distance_${row.sigmaDist}`;
    derived[sigmaDistanceId] = { value: row.sigmaDist, confidence: 7, source: { type: 'manual', description: 'Strike 生存曲线 σ 网格' } };
    derived[`seller_stat_strike_survival_${row.sigmaDist}_3d`] = statistic(row.d3, factors);
    derived[`seller_stat_strike_survival_${row.sigmaDist}_5d`] = statistic(row.d5, factors);
    derived[`seller_stat_strike_survival_${row.sigmaDist}_10d`] = statistic(row.d10, factors);
    derived[`seller_stat_strike_survival_${row.sigmaDist}_5d_n`] = createDerivedFactor(row.d5.n, [{ factorId: HISTORY_ID, weight: 1 }], factors);
    derived[`seller_stat_strike_survival_${row.sigmaDist}_5d_window_days`] = createDerivedFactor(row.d5.windowDays, [{ factorId: HISTORY_ID, weight: 1 }], factors);
    derived[`seller_stat_strike_survival_${row.sigmaDist}_5d_formula_key`] = createDerivedFactor(row.d5.formulaKey, [{ factorId: HISTORY_ID, weight: 1 }], factors);
  }
  const referenceInputs = [{ factorId: 'seller_previous_close', weight: .5 }, { factorId: 'seller_sigma_20', weight: .5 }];
  derived.seller_reference_strike_1sigma = factors.seller_previous_close.confidence > 0 && derived.seller_sigma_20.confidence > 0
    ? createDerivedFactor((previousClose ?? 0) * Math.exp(-stats.todayMove.sigma20), referenceInputs, { ...factors, ...derived })
    : fallbackFactor(0, '前收或 sigma20 不可用');
  const triggerInputs = [{ factorId: 'seller_today_log_return', weight: .5 }, { factorId: 'seller_sigma_20', weight: .5 }];
  derived.seller_watch_trigger_distance = createDerivedFactor(
    Math.max(0, stats.todayMove.returnPct + DEFAULT_SELLER_OPPORTUNITY_POLICY.watchSigma * stats.todayMove.sigma20), triggerInputs, { ...factors, ...derived },
  );
  derived.seller_open_trigger_distance = createDerivedFactor(
    Math.max(0, stats.todayMove.returnPct + DEFAULT_SELLER_OPPORTUNITY_POLICY.openSigma * stats.todayMove.sigma20), triggerInputs, { ...factors, ...derived },
  );
  // CSP carry 是独立于回撤事件的评分：IV/VRP、该 σ 的历史生存率、可管理性/尾部风险。
  // 不把缺失统计当成 0 分，避免伪造可交易信号。
  for (const sigma of CARRY_SIGMAS) {
    const key = carryKey(sigma);
    const survivalId = `seller_stat_strike_survival_${sigma}_5d`;
    const ids = ['iv_rank', 'vol_premium', survivalId, 'seller_stat_manage_recover_5d', 'seller_stat_manage_repair_success_15d', 'seller_stat_manage_continue_drop_5d', 'seller_stat_manage_worst_5d_drop'];
    const usable = ids.every(id => factors[id]?.confidence > 0 || derived[id]?.confidence > 0);
    const source = { ...factors, ...derived };
    if (!usable) {
      derived[`seller_csp_carry_${key}_score`] = fallbackFactor(0, `${sigma}σ CSP carry 依赖缺失`);
      derived[`seller_csp_carry_${key}_eligible`] = fallbackFactor(false, `${sigma}σ CSP carry 依赖缺失`);
      derived[`seller_csp_carry_${key}_reason`] = fallbackFactor('依赖缺失', `${sigma}σ CSP carry 依赖缺失`);
      continue;
    }
    const ivRank = (source.iv_rank.value as number);
    const vrp = (source.vol_premium.value as number);
    const survival = (source[survivalId].value as number) * 100;
    const recover = (source.seller_stat_manage_recover_5d.value as number) * 100;
    const repair = (source.seller_stat_manage_repair_success_15d.value as number) * 100;
    const continueDrop = (source.seller_stat_manage_continue_drop_5d.value as number) * 100;
    const worstDrop = Math.abs((source.seller_stat_manage_worst_5d_drop.value as number) * 100);
    const premium = Math.max(0, Math.min(100, ivRank * .5 + Math.max(0, vrp - 1) * 100));
    const manageable = Math.max(0, Math.min(100, recover * .25 + repair * .35 + (100 - continueDrop) * .2 + Math.max(0, 100 - worstDrop * 10) * .2));
    const score = Math.round(Math.max(0, Math.min(100, premium * .4 + survival * .35 + manageable * .25)));
    const scoreId = `seller_csp_carry_${key}_score`;
    derived[scoreId] = createDerivedFactor(score, ids.map(factorId => ({ factorId, weight: 1 / ids.length })), source);
    const withScore = { ...source, ...derived };
    const minimumScore = DEFAULT_SELLER_OPPORTUNITY_POLICY.cspCarry.minimumScores[sigma];
    const eligible = score >= minimumScore;
    derived[`seller_csp_carry_${key}_eligible`] = createDerivedFactor(eligible, [{ factorId: scoreId, weight: 1 }], withScore);
    derived[`seller_csp_carry_${key}_reason`] = createDerivedFactor(
      `${sigma}σ：IV/VRP ${premium.toFixed(0)} · 生存 ${survival.toFixed(0)}% · 可管理 ${manageable.toFixed(0)} · 阈值 ${minimumScore}${eligible ? ' · 达标' : ' · 未达标'}`,
      [{ factorId: scoreId, weight: 1 }], withScore,
    );
  }
  const carrySource = { ...factors, ...derived };
  const selectedSigma = DEFAULT_SELLER_OPPORTUNITY_POLICY.cspCarry.sigmaPriority.find((sigma) => {
    const eligible = carrySource[`seller_csp_carry_${carryKey(sigma)}_eligible`];
    return eligible?.confidence > 0 && eligible.value === true;
  });
  derived.seller_csp_carry_selected_sigma = selectedSigma === undefined
    ? fallbackFactor(0, '无 CSP carry 达标 σ 档')
    : createDerivedFactor(selectedSigma, DEFAULT_SELLER_OPPORTUNITY_POLICY.cspCarry.sigmaPriority.map((sigma) => ({ factorId: `seller_csp_carry_${carryKey(sigma)}_eligible`, weight: .25 })), carrySource);
  return { ...factors, ...derived };
}

/** 将本轮日内快照的锚点与历史同桶统计统一为只读解释因子，不参与授权。 */
export function addAnchoredManageabilityFactors(
  base: FactorMap,
  stats: SellerStats | undefined,
  anchorPoints: SellerOpportunityLifecyclePoint[],
): FactorMap {
  const point = anchorPoints.find((item) => {
    const sigma = item.downsideSigma;
    const price = item.price;
    return !!sigma && !!price && sigma.confidence > 0 && sigma.value >= .5
      && price.confidence > 0 && Number.isFinite(price.value) && price.value > 0;
  });
  const currentPrice = base.underlying_price;
  const anchor = point?.price
    ? createRawFactor(point.price.value, value => Number.isFinite(value) && value > 0, 'Supabase')
    : currentPrice?.confidence > 0
      ? fallbackFactor(currentPrice.value as number, '未找到本轮首次 ≥0.5σ 的日内快照；当前价格仅作临时锚')
      : fallbackFactor(0, '日内锚与当前价格均不可用');
  const anchorSource = point
    ? { value: 'snapshot', confidence: 7, source: { type: 'manual' as const, description: '本轮首次 ≥0.5σ 日内快照' } }
    : fallbackFactor('current_fallback', '未找到本轮首次 ≥0.5σ 的日内快照');
  const anchorTime = point
    ? { value: point.time, confidence: 7, source: { type: 'manual' as const, description: '本轮首次 ≥0.5σ 日内快照时间' } }
    : fallbackFactor(null, '未找到本轮首次 ≥0.5σ 的日内快照');
  const previousClose = base.seller_previous_close;
  const inputs = [{ factorId: 'seller_manageability_anchor', weight: .5 }, { factorId: 'seller_previous_close', weight: .5 }];
  const factors: FactorMap = { ...base, seller_manageability_anchor: anchor };
  const anchoredBucket = stats?.anchoredManageability?.bucket ?? null;
  const available = !!anchoredBucket;
  return {
    ...factors,
    seller_manageability_available: available
      ? createDerivedFactor(true, [{ factorId: 'seller_stat_manage_anchored_recover_5d', weight: 1 }], factors)
      : fallbackFactor(false, anchoredBucket ? '锚定价格不可用' : '当前未处于 ≥0.5σ 下行压力'),
    seller_manageability_bucket: anchoredBucket
      ? { value: anchoredBucket, confidence: 7, source: { type: 'manual', description: '当前下行 σ 桶' } }
      : fallbackFactor(null, '当前未处于 ≥0.5σ 下行压力'),
    seller_manageability_anchor: anchor,
    seller_manageability_anchor_source: anchorSource,
    seller_manageability_anchor_time: anchorTime,
    seller_manageability_half_retrace_target: typeof anchor.value === 'number' && previousClose?.confidence > 0
      ? createDerivedFactor(anchor.value + .5 * ((previousClose.value as number) - anchor.value), inputs, factors)
      : fallbackFactor(null, '当前锚或前收不可用'),
    seller_manageability_repair_target: previousClose?.confidence > 0
      ? createDerivedFactor(previousClose.value as number, [{ factorId: 'seller_previous_close', weight: 1 }], factors)
      : fallbackFactor(null, '前收不可用'),
  };
}

type StrikeChainPoint = { expiration: string; daysToExpiration: number; puts: Array<{ strike: number }> };
const SURVIVAL_HORIZONS = [3, 5, 10] as const;

/** 将真实 PUT 链映射到 Strike 生存曲线；理论 σ 位置仅用于选取最近的真实 strike。 */
export function addStrikeSurvivalChainFactors(base: FactorMap, stats: SellerStats, points: IVPoint[]): FactorMap {
  const validChain: StrikeChainPoint[] = (points ?? []).flatMap(point => {
    const puts = (point.contracts?.puts ?? [])
      .filter(contract => Number.isFinite(contract.strike) && contract.strike > 0)
      .map(contract => ({ strike: contract.strike }));
    return Number.isFinite(point.daysToExpiration)
      && point.daysToExpiration > 0
      && !Number.isNaN(Date.parse(point.expiration))
      && puts.length > 0
      ? [{ expiration: point.expiration, daysToExpiration: point.daysToExpiration, puts }]
      : [];
  });
  const strikeChain = base.iv_curve?.confidence > 0 && validChain.length > 0
    ? createDerivedFactor(validChain, [{ factorId: 'iv_curve', weight: 1 }], base)
    : fallbackFactor([] as StrikeChainPoint[], '真实期权链不可用');
  const factors: FactorMap = {
    ...base,
    seller_strike_chain: strikeChain,
  };
  const derived: FactorMap = {};

  for (const horizon of SURVIVAL_HORIZONS) {
    const prefix = `seller_strike_horizon_${horizon}d`;
    const spot = factors.underlying_price?.confidence > 0 ? factors.underlying_price.value as number : 0;
    const expiration = factors.seller_strike_chain.confidence > 0 && spot > 0
      ? validChain
        .filter(point => point.daysToExpiration >= horizon && point.puts.some(put => put.strike < spot))
        .sort((a, b) => a.daysToExpiration - b.daysToExpiration || a.expiration.localeCompare(b.expiration))[0]
      : undefined;
    const inputs = [{ factorId: 'seller_strike_chain', weight: .5 }, { factorId: 'underlying_price', weight: .5 }];
    derived[`${prefix}_expiry`] = expiration
      ? createDerivedFactor(expiration.expiration, inputs, factors)
      : fallbackFactor('', `${horizon}日无 DTE>=${horizon} 的有效 OTM PUT 到期`);
    derived[`${prefix}_dte`] = expiration
      ? createDerivedFactor(expiration.daysToExpiration, inputs, factors)
      : fallbackFactor(0, `${horizon}日无 DTE>=${horizon} 的有效 OTM PUT 到期`);
  }

  for (const row of stats.strikeSurvival) {
    const sigmaId = `seller_strike_sigma_distance_${row.sigmaDist}`;
    const targetId = `seller_strike_target_${row.sigmaDist}`;
    const targetInputs = [
      { factorId: 'underlying_price', weight: 1 / 3 },
      { factorId: 'seller_sigma_20', weight: 1 / 3 },
      { factorId: sigmaId, weight: 1 / 3 },
    ];
    const allFactors = { ...factors, ...derived };
    derived[targetId] = factors.underlying_price?.confidence > 0
      && factors.seller_sigma_20?.confidence > 0
      && factors[sigmaId]?.confidence > 0
      ? createDerivedFactor(
        (factors.underlying_price.value as number) * (1 - (factors[sigmaId].value as number) * (factors.seller_sigma_20.value as number)),
        targetInputs,
        allFactors,
      )
      : fallbackFactor(0, `${row.sigmaDist}σ 理论选约位置依赖缺失`);

    for (const horizon of SURVIVAL_HORIZONS) {
      const prefix = `seller_strike_contract_${row.sigmaDist}_${horizon}d`;
      const currentFactors = { ...factors, ...derived };
      const expiryValue = derived[`seller_strike_horizon_${horizon}d_expiry`];
      const expiration = expiryValue?.confidence > 0
        ? validChain.find(point => point.expiration === expiryValue.value)
        : undefined;
      const spot = factors.underlying_price?.confidence > 0 ? factors.underlying_price.value as number : 0;
      const contract = expiration && derived[targetId].confidence > 0
        ? expiration.puts
          .filter(put => put.strike < spot)
          .sort((a, b) => Math.abs(a.strike - (derived[targetId].value as number)) - Math.abs(b.strike - (derived[targetId].value as number)) || a.strike - b.strike)[0]
        : undefined;
      if (factors.seller_strike_chain.confidence === 0 || !expiration || !contract) {
        derived[`${prefix}_strike`] = fallbackFactor(0, `${horizon}日真实 PUT 合约不可用`);
        derived[`${prefix}_distance_pct`] = fallbackFactor(0, `${horizon}日真实 PUT 距现价不可用`);
        continue;
      }
      derived[`${prefix}_strike`] = createDerivedFactor(contract.strike, [
        { factorId: 'seller_strike_chain', weight: .5 },
        { factorId: targetId, weight: .5 },
      ], currentFactors);
      const strikeId = `${prefix}_strike`;
      const withContract = { ...factors, ...derived };
      derived[`${prefix}_distance_pct`] = factors.underlying_price?.confidence > 0
        ? createDerivedFactor(contract.strike / (factors.underlying_price.value as number) - 1, [
          { factorId: strikeId, weight: .5 },
          { factorId: 'underlying_price', weight: .5 },
        ], withContract)
        : fallbackFactor(0, `${horizon}日真实 PUT 距现价依赖缺失`);
    }
  }
  return { ...factors, ...derived };
}

/** RecommendationEngine 已完成选约；这里只把结果包装为链数据派生因子。 */
export function addCspCandidateFactors(
  base: FactorMap,
  candidate: any,
  chainAsOf: string,
  expectedMoveMatrix?: FinancialFactor<Array<{ days: number; move: number }>>,
): FactorMap {
  const factors: FactorMap = {
    ...base,
    seller_option_chain_as_of: createRawFactor(chainAsOf, value => !Number.isNaN(Date.parse(value)), 'Yahoo'),
    seller_option_quote_proxy_policy: { value: 'last_trade_5pct_7d', confidence: 7, source: { type: 'manual', description: '最后成交代理：7日内有效，买卖各 5% haircut' } },
    csp_expected_move_matrix: expectedMoveMatrix ?? fallbackFactor([], 'CSP 到期期限的预期移动不可用'),
  };
  const number = (value: unknown, id: string) => typeof value === 'number' && Number.isFinite(value)
    ? createDerivedFactor(value, [{ factorId: 'seller_option_chain_as_of', weight: 1 }], factors)
    : fallbackFactor(null, `${id} 不可用`);
  const quoteInputs = candidate?.quoteSource === 'last_trade'
    ? [{ factorId: 'seller_option_chain_as_of', weight: .5 }, { factorId: 'seller_option_quote_proxy_policy', weight: .5 }]
    : [{ factorId: 'seller_option_chain_as_of', weight: 1 }];
  const quote = (value: unknown, id: string) => value !== undefined && value !== null
    ? createDerivedFactor(value, quoteInputs, factors)
    : fallbackFactor(null, `${id} 不可用`);
  const candidateFactors: FactorMap = {
    ...factors,
    csp_short_strike: number(candidate?.strike, 'csp_short_strike'),
    csp_expiry: quote(candidate?.expiry, 'csp_expiry'),
    csp_dte: number(candidate?.dte, 'csp_dte'),
    csp_delta: number(candidate?.delta, 'csp_delta'),
    csp_bid: quote(candidate?.bid, 'csp_bid'),
    csp_ask: quote(candidate?.ask, 'csp_ask'),
    csp_mid: quote(candidate?.quoteSource === 'market' ? candidate?.mid : null, 'csp_mid'),
    csp_premium_price: quote(candidate?.premiumPrice, 'csp_premium_price'),
    csp_last_price: quote(candidate?.lastPrice, 'csp_last_price'),
    csp_quote_source: quote(candidate?.quoteSource, 'csp_quote_source'),
    csp_quote_as_of: quote(candidate?.quoteAsOf, 'csp_quote_as_of'),
    csp_quote_haircut: quote(candidate?.quoteHaircut, 'csp_quote_haircut'),
    csp_win_probability: number(candidate?.winProb, 'csp_win_probability'),
    csp_conditional_loss: number(candidate?.conditionalLoss, 'csp_conditional_loss'),
    csp_cvar: number(candidate?.cvar, 'csp_cvar'),
    csp_apr: quote(candidate?.apr, 'csp_apr'),
    csp_breakeven: quote(candidate?.breakeven, 'csp_breakeven'),
    csp_vrp: number(candidate?.vrp, 'csp_vrp'),
  };
  const matrix = expectedMoveMatrix?.value ?? [];
  const move = candidate?.dte && Number.isFinite(candidate.dte)
    ? matrix.filter(row => Number.isFinite(row.move) && row.move > 0)
      .sort((a, b) => Math.abs(a.days - candidate.dte) - Math.abs(b.days - candidate.dte))[0]?.move
    : undefined;
  return {
    ...candidateFactors,
    csp_expected_move: typeof move === 'number' && candidateFactors.csp_dte.confidence > 0 && candidateFactors.csp_expected_move_matrix.confidence > 0
      ? createDerivedFactor(move, [
        { factorId: 'csp_dte', weight: .5 },
        { factorId: 'csp_expected_move_matrix', weight: .5 },
      ], candidateFactors)
      : fallbackFactor(null, 'CSP 到期期限的预期移动不可用'),
  };
}

type CandidateBoundaryRow = { days: number; lower: number; effectiveLower?: number };
type CandidateEvaluationInput = {
  matrixRows: CandidateBoundaryRow[];
  globalLower: number;
  selectedCarrySigma: 1 | 1.5 | 2 | 2.5 | null;
  /** 手动指定的合约不经过 CSP 选约器，不能伪造放宽轮次。 */
  manuallyTargeted?: boolean;
  targetDelta?: number;
};

const CANDIDATE_SIGMA_GRID = [0.5, 1, 1.5, 2, 2.5] as const;

/**
 * 将已选 CSP 合约的边界、σ 网格概率和 Carry 关系写入扁平 FactorMap。
 * 这里只解释 RecommendationEngine 的输出，绝不参与或改变选约/授权。
 */
export function addCandidateEvaluationFactors(base: FactorMap, input: CandidateEvaluationInput): FactorMap {
  const candidateInputs = ['csp_short_strike', 'csp_dte', 'csp_delta', 'underlying_price', 'seller_sigma_20'];
  const hasCandidate = candidateInputs.every((id) => base[id]?.confidence > 0);
  const reference = <T>(id: string, fallbackValue: T, reason: string): FinancialFactor<T> =>
    base[id]?.confidence > 0
      ? createDerivedFactor(base[id].value as T, [{ factorId: id, weight: 1 }], base)
      : fallbackFactor(fallbackValue, reason);
  const unavailable = (reason: string): FactorMap => ({
    seller_candidate_available: fallbackFactor(false, reason),
    seller_candidate_strike: fallbackFactor(null, reason),
    seller_candidate_expiry: fallbackFactor(null, reason),
    seller_candidate_dte: fallbackFactor(null, reason),
    seller_candidate_delta: fallbackFactor(null, reason),
    seller_candidate_selection_attempt: fallbackFactor(null, reason),
    seller_candidate_target_delta: fallbackFactor(null, reason),
    seller_candidate_delta_band: fallbackFactor(null, reason),
    seller_candidate_delta_gap: fallbackFactor(null, reason),
    seller_candidate_effective_lower: fallbackFactor(null, reason),
    seller_candidate_global_lower: fallbackFactor(null, reason),
    seller_candidate_distance_pct: fallbackFactor(null, reason),
    seller_candidate_distance_sigma: fallbackFactor(null, reason),
    seller_candidate_probability_grid_sigma: fallbackFactor(null, reason),
    seller_candidate_probability_in_grid: fallbackFactor(false, reason),
    seller_candidate_probability_available: fallbackFactor(false, reason),
    seller_candidate_probability_survival_5d: fallbackFactor(null, reason),
    seller_candidate_probability_n: fallbackFactor(0, reason),
    seller_candidate_probability_window_days: fallbackFactor(0, reason),
    seller_candidate_probability_formula_key: fallbackFactor('', reason),
    seller_candidate_probability_confidence: fallbackFactor(0, reason),
    seller_candidate_probability_note: fallbackFactor('候选概率不可用', reason),
    // 无执行候选时仍保留既有的 1σ 统计参考；它不是策略合约。
    seller_candidate_probability_reference_strike: reference('seller_reference_strike_1sigma', null, '统计参考行权价不可用'),
    seller_candidate_probability_reference_survival_5d: reference('seller_stat_strike_survival_1_5d', null, '统计参考概率不可用'),
    seller_candidate_probability_reference_n: reference('seller_stat_strike_survival_1_5d_n', 0, '统计参考样本数不可用'),
    seller_candidate_probability_reference_window_days: reference('seller_stat_strike_survival_1_5d_window_days', 0, '统计参考历史窗口不可用'),
    seller_candidate_probability_reference_formula_key: reference('seller_stat_strike_survival_1_5d_formula_key', '', '统计参考公式不可用'),
    seller_candidate_matches_carry_sigma: fallbackFactor(false, reason),
    seller_candidate_carry_relation: fallbackFactor('无候选合约', reason),
    seller_candidate_lifecycle_plan_available: fallbackFactor(false, reason),
    seller_candidate_lifecycle_plan_risk_reference_underlying: fallbackFactor(null, reason),
    seller_candidate_lifecycle_plan_realization_reference_underlying: fallbackFactor(null, reason),
    seller_candidate_lifecycle_plan_expected_move: fallbackFactor(null, reason),
    seller_candidate_lifecycle_plan_reason: fallbackFactor(reason, reason),
  });
  if (!hasCandidate) return { ...base, ...unavailable('CSP 候选或 σ 输入不可用') };

  const strike = base.csp_short_strike.value as number;
  const dte = base.csp_dte.value as number;
  const delta = base.csp_delta.value as number;
  const spot = base.underlying_price.value as number;
  const sigma20 = base.seller_sigma_20.value as number;
  if (!(strike > 0 && dte >= 0 && spot > 0 && sigma20 > 0 && Number.isFinite(delta))) {
    return { ...base, ...unavailable('CSP 候选数值无效') };
  }

  const source: FactorMap = { ...base };
  const candidateSources = candidateInputs.map((factorId) => ({ factorId, weight: 1 / candidateInputs.length }));
  const candidateAvailable = createDerivedFactor(true, candidateSources, source);
  const nearestBoundary = input.matrixRows
    .filter((row) => Number.isFinite(row.days) && Number.isFinite(row.lower) && Number.isFinite(row.effectiveLower ?? row.lower))
    .sort((a, b) => Math.abs(a.days - dte) - Math.abs(b.days - dte))[0];
  const boundaryFactor = nearestBoundary
    ? createDerivedFactor(nearestBoundary.effectiveLower ?? nearestBoundary.lower, [{ factorId: 'csp_dte', weight: .5 }, { factorId: 'csp_expected_move_matrix', weight: .5 }], source)
    : fallbackFactor(null, '候选到期日缺少预期移动边界');
  const globalFactor = Number.isFinite(input.globalLower) && input.globalLower > 0
    ? createDerivedFactor(input.globalLower, [{ factorId: 'csp_expected_move_matrix', weight: 1 }], source)
    : fallbackFactor(null, '全局预期移动下界不可用');
  const distanceSigma = createDerivedFactor((spot - strike) / spot / sigma20, [
    { factorId: 'csp_short_strike', weight: 1 / 3 }, { factorId: 'underlying_price', weight: 1 / 3 }, { factorId: 'seller_sigma_20', weight: 1 / 3 },
  ], source);
  const distancePct = createDerivedFactor(strike / spot - 1, [
    { factorId: 'csp_short_strike', weight: .5 }, { factorId: 'underlying_price', weight: .5 },
  ], source);
  const inGrid = distanceSigma.value >= CANDIDATE_SIGMA_GRID[0] && distanceSigma.value <= CANDIDATE_SIGMA_GRID.at(-1)!;
  const gridSigma = inGrid
    ? CANDIDATE_SIGMA_GRID.reduce((best, sigma) => Math.abs(sigma - distanceSigma.value) < Math.abs(best - distanceSigma.value) ? sigma : best)
    : null;
  const survivalId = gridSigma === null ? null : `seller_stat_strike_survival_${gridSigma}_5d`;
  const survivalNId = survivalId && `${survivalId}_n`;
  const survivalWindowDaysId = survivalId && `${survivalId}_window_days`;
  const survivalFormulaKeyId = survivalId && `${survivalId}_formula_key`;
  const survival = survivalId && source[survivalId]?.confidence > 0
    ? createDerivedFactor(source[survivalId].value as number, [{ factorId: survivalId, weight: 1 }], source)
    : fallbackFactor(null, gridSigma === null ? '候选超出 0.5–2.5σ 概率网格' : '候选 σ 网格历史样本不足');
  const probabilityInGrid = createDerivedFactor(inGrid, [{ factorId: 'seller_candidate_distance_sigma', weight: 1 }], { ...source, seller_candidate_distance_sigma: distanceSigma });
  const probabilityAvailable = survival.confidence > 0
    ? createDerivedFactor(true, [{ factorId: survivalId!, weight: 1 }], source)
    : fallbackFactor(false, survival.source.type === 'fallback' ? survival.source.reason : '候选概率不可用');
  const probabilityNote = gridSigma === null
    ? '超出统计网格，5日概率不可用'
    : survival.confidence > 0
      ? 'σ 网格近似，不是该合约历史回放'
      : '样本不足';

  const vrp = source.csp_vrp?.confidence > 0 ? source.csp_vrp.value as number : 0;
  const baseTarget = input.targetDelta ?? DEFAULT_CSP_SETTINGS.targetDelta;
  const targetDelta = vrp > .10 ? Math.max(baseTarget + .05, -.12) : baseTarget;
  const baseBand = vrp > .10 ? .05 : .08;
  const selectionAttempt = input.manuallyTargeted
    ? null
    : [0, 1, 2].find((attempt) => Math.abs(delta - targetDelta) <= baseBand * Math.pow(1.5, attempt)) ?? null;
  const attemptFactor = selectionAttempt === null
    ? fallbackFactor(null, input.manuallyTargeted ? '手动目标不经过 CSP 选约放宽' : '候选不满足任一 Delta 放宽轮次')
    : createDerivedFactor(selectionAttempt, [{ factorId: 'csp_delta', weight: .5 }, { factorId: 'csp_vrp', weight: .5 }], source);
  const targetDeltaFactor = createDerivedFactor(targetDelta, [{ factorId: 'csp_vrp', weight: 1 }], source);
  const deltaBandFactor = selectionAttempt === null
    ? fallbackFactor(null, '候选 Delta 放宽轮次不可用')
    : createDerivedFactor(baseBand * Math.pow(1.5, selectionAttempt), [{ factorId: 'csp_delta', weight: .5 }, { factorId: 'csp_vrp', weight: .5 }], source);
  const deltaGapFactor = createDerivedFactor(Math.abs(delta - targetDelta), [{ factorId: 'csp_delta', weight: .5 }, { factorId: 'csp_vrp', weight: .5 }], source);
  const carryMatch = gridSigma !== null && gridSigma === input.selectedCarrySigma;
  const carryRelation = gridSigma === null
    ? '候选超出 Carry 概率网格'
    : input.selectedCarrySigma === null
      ? `候选约 ${gridSigma}σ；当前无 Carry 达标档`
      : carryMatch
        ? `候选约 ${gridSigma}σ，与 Carry 选中档一致`
        : `候选约 ${gridSigma}σ；Carry 选中 ${input.selectedCarrySigma}σ`;
  const withDistance: FactorMap = { ...source, seller_candidate_distance_sigma: distanceSigma };
  const carryRelationInputs = input.selectedCarrySigma !== null && source.seller_csp_carry_selected_sigma?.confidence > 0
    ? [{ factorId: 'seller_candidate_distance_sigma', weight: .5 }, { factorId: 'seller_csp_carry_selected_sigma', weight: .5 }]
    : [{ factorId: 'seller_candidate_distance_sigma', weight: 1 }];
  const lifecyclePlanIds = ['csp_win_probability', 'csp_premium_price', 'csp_conditional_loss', 'csp_cvar', 'csp_breakeven', 'csp_expected_move'];
  const lifecyclePlanValues = lifecyclePlanIds.map((id) => source[id]);
  const lifecyclePlanValid = lifecyclePlanValues.every((item) => item?.confidence > 0 && typeof item.value === 'number' && Number.isFinite(item.value));
  const lifecyclePlanInputs = lifecyclePlanIds.map((factorId) => ({ factorId, weight: 1 / lifecyclePlanIds.length }));
  const lifecyclePlan = (() => {
    if (!lifecyclePlanValid) return { available: fallbackFactor(false, '候选概率或美元风险输入不完整') };
    const [winProbability, premium, conditionalLoss, cvar, breakeven, expectedMove] = lifecyclePlanValues.map((item) => item!.value as number);
    const expectedPremium = winProbability * premium;
    const tailLoss = Math.max(conditionalLoss, cvar);
    const expectedLoss = (1 - winProbability) * tailLoss;
    const denominator = expectedPremium + expectedLoss;
    if (!(winProbability > 0 && winProbability < 1 && premium > 0 && conditionalLoss > 0 && cvar > 0 && breakeven > 0 && expectedMove > 0 && denominator > 0)) {
      return { available: fallbackFactor(false, '候选概率或美元风险数据无效') };
    }
    return {
      available: createDerivedFactor(true, lifecyclePlanInputs, source),
      risk: createDerivedFactor(breakeven - expectedMove * expectedLoss / denominator, lifecyclePlanInputs, source),
      realization: createDerivedFactor(breakeven + expectedMove * expectedPremium / denominator, lifecyclePlanInputs, source),
      expectedMove: createDerivedFactor(expectedMove, [{ factorId: 'csp_expected_move', weight: 1 }], source),
      reason: createDerivedFactor('建仓锚定模型：以胜率、权利金与较大尾损映射两条参考线；CVaR 与条件损失不重复相加。不是已校准的触发概率，也不是自动平仓价格。无持仓动态标记价。', lifecyclePlanInputs, source),
    };
  })();
  return {
    ...source,
    seller_candidate_available: candidateAvailable,
    seller_candidate_strike: createDerivedFactor(strike, [{ factorId: 'csp_short_strike', weight: 1 }], source),
    seller_candidate_expiry: source.csp_expiry?.confidence > 0
      ? createDerivedFactor(source.csp_expiry.value as string, [{ factorId: 'csp_expiry', weight: 1 }], source)
      : fallbackFactor(null, '候选到期日不可用'),
    seller_candidate_dte: createDerivedFactor(dte, [{ factorId: 'csp_dte', weight: 1 }], source),
    seller_candidate_delta: createDerivedFactor(delta, [{ factorId: 'csp_delta', weight: 1 }], source),
    seller_candidate_selection_attempt: attemptFactor,
    seller_candidate_target_delta: targetDeltaFactor,
    seller_candidate_delta_band: deltaBandFactor,
    seller_candidate_delta_gap: deltaGapFactor,
    seller_candidate_effective_lower: boundaryFactor,
    seller_candidate_global_lower: globalFactor,
    seller_candidate_distance_pct: distancePct,
    seller_candidate_distance_sigma: distanceSigma,
    seller_candidate_probability_grid_sigma: gridSigma === null
      ? fallbackFactor(null, '候选超出 0.5–2.5σ 概率网格')
      : createDerivedFactor(gridSigma, [{ factorId: 'seller_candidate_distance_sigma', weight: 1 }], withDistance),
    seller_candidate_probability_in_grid: probabilityInGrid,
    seller_candidate_probability_available: probabilityAvailable,
    seller_candidate_probability_survival_5d: survival,
    seller_candidate_probability_n: survivalNId && source[survivalNId]?.confidence > 0
      ? createDerivedFactor(source[survivalNId].value as number, [{ factorId: survivalNId, weight: 1 }], source)
      : fallbackFactor(0, '候选概率样本数不可用'),
    seller_candidate_probability_window_days: survivalWindowDaysId && source[survivalWindowDaysId]?.confidence > 0
      ? createDerivedFactor(source[survivalWindowDaysId].value as number, [{ factorId: survivalWindowDaysId, weight: 1 }], source)
      : fallbackFactor(0, '候选概率历史窗口不可用'),
    seller_candidate_probability_formula_key: survivalFormulaKeyId && source[survivalFormulaKeyId]?.confidence > 0
      ? createDerivedFactor(source[survivalFormulaKeyId].value as string, [{ factorId: survivalFormulaKeyId, weight: 1 }], source)
      : fallbackFactor('', '候选概率公式不可用'),
    seller_candidate_probability_confidence: survivalId && source[survivalId]?.confidence > 0
      ? createDerivedFactor(source[survivalId].confidence, [{ factorId: survivalId, weight: 1 }], source)
      : fallbackFactor(0, '候选概率置信度不可用'),
    seller_candidate_probability_note: createDerivedFactor(probabilityNote, [{ factorId: 'seller_candidate_probability_in_grid', weight: 1 }], { ...withDistance, seller_candidate_probability_in_grid: probabilityInGrid }),
    seller_candidate_probability_reference_strike: reference('seller_reference_strike_1sigma', null, '统计参考行权价不可用'),
    seller_candidate_probability_reference_survival_5d: reference('seller_stat_strike_survival_1_5d', null, '统计参考概率不可用'),
    seller_candidate_probability_reference_n: reference('seller_stat_strike_survival_1_5d_n', 0, '统计参考样本数不可用'),
    seller_candidate_probability_reference_window_days: reference('seller_stat_strike_survival_1_5d_window_days', 0, '统计参考历史窗口不可用'),
    seller_candidate_probability_reference_formula_key: reference('seller_stat_strike_survival_1_5d_formula_key', '', '统计参考公式不可用'),
    seller_candidate_matches_carry_sigma: createDerivedFactor(carryMatch, carryRelationInputs, withDistance),
    seller_candidate_carry_relation: createDerivedFactor(carryRelation, carryRelationInputs, withDistance),
    seller_candidate_lifecycle_plan_available: lifecyclePlan.available,
    seller_candidate_lifecycle_plan_risk_reference_underlying: lifecyclePlan.risk ?? fallbackFactor(null, lifecyclePlan.available.source.type === 'fallback' ? lifecyclePlan.available.source.reason : '候选操作线不可用'),
    seller_candidate_lifecycle_plan_realization_reference_underlying: lifecyclePlan.realization ?? fallbackFactor(null, lifecyclePlan.available.source.type === 'fallback' ? lifecyclePlan.available.source.reason : '候选操作线不可用'),
    seller_candidate_lifecycle_plan_expected_move: lifecyclePlan.expectedMove ?? fallbackFactor(null, lifecyclePlan.available.source.type === 'fallback' ? lifecyclePlan.available.source.reason : '候选操作线不可用'),
    seller_candidate_lifecycle_plan_reason: lifecyclePlan.reason ?? fallbackFactor(lifecyclePlan.available.source.type === 'fallback' ? lifecyclePlan.available.source.reason : '候选操作线不可用', '候选操作线不可用'),
  };
}
