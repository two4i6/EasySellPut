import { expect, test } from 'bun:test';
import { buildPutCreditSpreadOpen, buildPutCreditSpreadOpenNearestFeasibleExpiry, buildPutCreditSpreadProposal, evaluatePcsStreakCooldownBlocked, evaluatePutCreditSpreadExit, evaluatePutCreditSpreadPageDecision, evaluatePutCreditSpreadPageSignal, evaluatePutCreditSpreadSafety, evaluatePutCreditSpreadTiming, finalizePutCreditSpread, putCreditSpreadTradeMeta, resolvePcsRescueExtremeWidth, resolvePcsRescueShortDelta, settlePutCreditSpread, updatePcsStreakStateOnClose } from './put-credit-spread';

test('PCS 到期结算通过统一多腿框架且封顶于价差宽度', () => {
  expect(settlePutCreditSpread({ expiry: '', shortStrike: 90, longStrike: 85, width: 5, quantity: 2, creditReceived: 300 }, 80)).toMatchObject({ cashImpact: -1000, pnl: -700 });
});

test('PCS 与 Equity Boost 的交易名称和 tag 由同一策略元数据提供', () => {
  expect(putCreditSpreadTradeMeta('PCS', 85, 90)).toEqual({ symbol: 'QQQ Put Credit Spread @85/90', strategyTag: 'QQQ_PUT_CREDIT_SPREAD' });
  expect(putCreditSpreadTradeMeta('EQUITY_BOOST', 85, 90).strategyTag).toBe('QQQ_EQUITY_BOOST_PUT_SPREAD');
  expect(putCreditSpreadTradeMeta('PCS_RESCUE', 85, 90)).toEqual({ symbol: 'QQQ PCS Rescue @85/90', strategyTag: 'QQQ_PCS_RESCUE' });
});

test('PCS_RESCUE 支持固定与透明状态桶 Delta，且目标有上下界', () => {
  expect(resolvePcsRescueShortDelta({ mode: 'fixed', fixedDelta: .05 })).toBe(.05);
  expect(resolvePcsRescueShortDelta({ mode: 'state_adaptive_v1', regime: 'BULL', vix: 12, rv20: .3, adx14: 25 })).toBe(.075);
  expect(resolvePcsRescueShortDelta({ mode: 'state_adaptive_v1', regime: 'RANGE_BOUND', vix: 18, rv20: .5, adx14: 15 })).toBe(.025);
  expect(resolvePcsRescueShortDelta({ mode: 'state_adaptive_v1', regime: 'BULL', vix: 16, rv20: .4, adx14: 15 })).toBe(.05);
  expect(resolvePcsRescueShortDelta({ mode: 'continuous_v1', regime: 'BULL', vix: 12, rv20: .3, adx14: 20, calmDelta: .1, normalDelta: .05, pressureDelta: .025 })).toBe(.1);
  expect(resolvePcsRescueShortDelta({ mode: 'continuous_v1', regime: 'BULL', vix: 20, rv20: .67, adx14: 12, calmDelta: .1, normalDelta: .05, pressureDelta: .025 })).toBe(.025);
  expect(resolvePcsRescueShortDelta({ mode: 'state_adaptive_quality_v1', regime: 'RISK_ON_EXTENDED', vix: 12.5, rv20: .3, adx14: 25, calmDelta: .1, normalDelta: .075, pressureDelta: .025 })).toBe(.1);
  expect(resolvePcsRescueShortDelta({ mode: 'state_adaptive_quality_v1', regime: 'RANGE_BOUND', vix: 13, rv20: .3, adx14: 25, versionPressure: true, calmDelta: .1, normalDelta: .075, pressureDelta: .025 })).toBe(.025);
  expect(resolvePcsRescueShortDelta({ mode: 'state_adaptive_quality_v1', regime: 'RISK_ON_EXTENDED', vix: 12, rv20: .3, adx14: 38, extremePressure: true, calmDelta: .1, normalDelta: .075, pressureDelta: .025 })).toBe(.025);
  expect(resolvePcsRescueShortDelta({ mode: 'state_adaptive_quality_v1', regime: 'RISK_ON_EXTENDED', vix: 12, rv20: .3, adx14: 38, extremePressure: true, extremeDelta: .04, calmDelta: .1, normalDelta: .075, pressureDelta: .025 })).toBe(.04);
  expect(resolvePcsRescueShortDelta({ mode: 'state_adaptive_quality_v1', regime: 'SIDEWAYS', vix: 29, rv20: .6, adx14: 20, calmDelta: .1, normalDelta: .075, pressureDelta: .025 })).toBe(.025);
  expect(resolvePcsRescueShortDelta({ mode: 'continuous_quality_v1', regime: 'RISK_ON_EXTENDED', vix: 12, rv20: .3, adx14: 38, extremePressure: true, extremeDelta: .2425, extremeBaseDelta: .20, extremeFallbackDelta: .18, calmDelta: .1, normalDelta: .075, pressureDelta: .025 })).toBe(.2425);
  expect(resolvePcsRescueShortDelta({ mode: 'continuous_quality_v2', regime: 'RISK_ON_WEAKENING', vix: 16, rv20: .4, adx14: 15, calmDelta: .1, normalDelta: .075, pressureDelta: .025 })).toBeGreaterThan(.075);
  expect(resolvePcsRescueShortDelta({ mode: 'continuous_quality_v2', regime: 'BULL', vix: 20, rv20: .7, adx14: 10, calmDelta: .1, normalDelta: .075, pressureDelta: .025 })).toBe(.025);
  expect(resolvePcsRescueShortDelta({ mode: 'continuous_quality_v3', regime: 'BULL', vix: 16, rv20: .4, adx14: 15, calmDelta: .12, normalDelta: .09, pressureDelta: .025 })).toBe(.09);
  expect(resolvePcsRescueShortDelta({ mode: 'continuous_quality_v3', regime: 'RANGE_BOUND', vix: 16, rv20: .4, adx14: 15, calmDelta: .12, normalDelta: .09, pressureDelta: .025 })).toBeGreaterThan(.09);
  expect(resolvePcsRescueShortDelta({ mode: 'continuous_quality_v4', regime: 'BULL', vix: 16, rv20: .4, adx14: 15, calmDelta: .12, normalDelta: .075, pressureDelta: .025 })).toBe(.075);
  expect(resolvePcsRescueShortDelta({ mode: 'continuous_quality_v4', regime: 'RANGE_BOUND', vix: 16, rv20: .4, adx14: 15, calmDelta: .12, normalDelta: .075, pressureDelta: .025 })).toBeGreaterThan(.075);
  expect(resolvePcsRescueShortDelta({ mode: 'range_fixed_quality_v1', regime: 'RANGE_BOUND', vix: 16, rv20: .4, adx14: 15, calmDelta: .11, normalDelta: .09, pressureDelta: .025 })).toBe(.09);
  expect(resolvePcsRescueShortDelta({ mode: 'range_fixed_quality_v1', regime: 'RANGE_BOUND', vix: 18, rv20: .4, adx14: 15, calmDelta: .11, normalDelta: .09, pressureDelta: .025 })).toBe(.025);
  expect(resolvePcsRescueShortDelta({ mode: 'range_fixed_quality_v1', regime: 'BULL', vix: 16, rv20: .4, adx14: 15, calmDelta: .11, normalDelta: .09, pressureDelta: .025 })).toBe(.075);
  expect(resolvePcsRescueShortDelta({ mode: 'range_smart_quality_v1', regime: 'RANGE_BOUND', vix: 16, rv20: .4, adx14: 15, calmDelta: .105, normalDelta: .12, pressureDelta: .0375 })).toBe(.12);
  expect(resolvePcsRescueShortDelta({ mode: 'range_smart_quality_v1', regime: 'BULL', vix: 13, rv20: .4, adx14: 25, calmDelta: .105, normalDelta: .12, pressureDelta: .0375 })).toBe(.105);
  expect(resolvePcsRescueShortDelta({ mode: 'range_smart_quality_v2', regime: 'BULL', vix: 13, rv20: .4, adx14: 25, priceVsSma200Pct: .12, calmDelta: .105, normalDelta: .12, pressureDelta: .0375 })).toBe(.105);
  expect(resolvePcsRescueShortDelta({ mode: 'range_smart_quality_v2', regime: 'BULL', vix: 13, rv20: .4, adx14: 25, priceVsSma200Pct: .15, calmDelta: .105, normalDelta: .12, pressureDelta: .0375 })).toBe(.1);
  expect(resolvePcsRescueShortDelta({ mode: 'range_smart_quality_v3', regime: 'BULL', vix: 13, rv20: .4, adx14: 25, priceVsSma200Pct: .12, calmDelta: .13, normalDelta: .12, pressureDelta: .0375 })).toBe(.13);
  expect(resolvePcsRescueShortDelta({ mode: 'range_smart_quality_v3', regime: 'BULL', vix: 13, rv20: .45, adx14: 25, priceVsSma200Pct: .12, calmDelta: .13, normalDelta: .12, pressureDelta: .0375 })).toBe(.1);
  expect(resolvePcsRescueShortDelta({ mode: 'range_smart_quality_v4', regime: 'BULL', vix: 13, rv20: .4, adx14: 25, priceVsSma200Pct: .12, priceExtensionAtr: 1.4, calmDelta: .15, normalDelta: .12, pressureDelta: .0375 })).toBe(.15);
  expect(resolvePcsRescueShortDelta({ mode: 'range_smart_quality_v4', regime: 'BULL', vix: 13, rv20: .4, adx14: 25, priceVsSma200Pct: .12, priceExtensionAtr: 1.5, calmDelta: .15, normalDelta: .12, pressureDelta: .0375 })).toBe(.1);
  expect(resolvePcsRescueShortDelta({ mode: 'range_smart_quality_v5', regime: 'BULL', vix: 18, rv20: .6, adx14: 15, pressureDelta: .04, calmDelta: .15, normalDelta: .12 })).toBe(.04);
  expect(resolvePcsRescueShortDelta({ mode: 'range_smart_quality_v5', regime: 'BULL', vix: 18, rv20: .8, adx14: 10, pressureDelta: .04, calmDelta: .15, normalDelta: .12 })).toBe(.0375);
  expect(resolvePcsRescueShortDelta({ mode: 'range_smart_quality_v6', regime: 'RANGE_BOUND', vix: 15, rv20: .35, adx14: 14, pressureDelta: .04, calmDelta: .15, normalDelta: .13 })).toBe(.12);
  expect(resolvePcsRescueShortDelta({ mode: 'range_smart_quality_v6', regime: 'RANGE_BOUND', vix: 15, rv20: .44, adx14: 14, pressureDelta: .04, calmDelta: .15, normalDelta: .13 })).toBe(.12);
  expect(resolvePcsRescueShortDelta({ mode: 'range_smart_quality_v6', regime: 'RANGE_BOUND', vix: 15, rv20: .50, adx14: 15, pressureDelta: .04, calmDelta: .15, normalDelta: .13 })).toBe(.13);
  expect(resolvePcsRescueShortDelta({ mode: 'range_smart_quality_v6', regime: 'RANGE_BOUND', vix: 18, rv20: .60, adx14: 15, pressureDelta: .04, calmDelta: .15, normalDelta: .13 })).toBe(.04);
  expect(resolvePcsRescueShortDelta({ mode: 'range_smart_quality_v6', regime: 'RANGE_BOUND', vix: 18, rv20: .80, adx14: 10, pressureDelta: .04, calmDelta: .15, normalDelta: .13 })).toBe(.0375);
  expect(resolvePcsRescueShortDelta({ mode: 'range_smart_quality_v7', regime: 'RANGE_BOUND', vix: 16, rv20: .55, adx14: 20, pressureDelta: .04, calmDelta: .15, normalDelta: .14 })).toBe(.14);
  expect(resolvePcsRescueShortDelta({ mode: 'range_smart_quality_v7', regime: 'RANGE_BOUND', vix: 16, rv20: .55, adx14: 14, pressureDelta: .04, calmDelta: .15, normalDelta: .14 })).toBe(.12);
  expect(resolvePcsRescueShortDelta({ mode: 'range_smart_quality_v8', regime: 'RANGE_BOUND', vix: 20, rv20: .45, adx14: 20, pressureDelta: .0425, calmDelta: .15, normalDelta: .13 })).toBe(.0425);
  expect(resolvePcsRescueShortDelta({ mode: 'range_smart_quality_v8', regime: 'RANGE_BOUND', vix: 20, rv20: .60, adx14: 15, pressureDelta: .0425, calmDelta: .15, normalDelta: .13 })).toBe(.0375);
  expect(resolvePcsRescueShortDelta({ mode: 'range_smart_quality_v9', regime: 'RANGE_BOUND', vix: 20, rv20: .54, adx14: 14, pressureDelta: .041, calmDelta: .15, normalDelta: .13 })).toBe(.041);
  expect(resolvePcsRescueShortDelta({ mode: 'range_smart_quality_v9', regime: 'RANGE_BOUND', vix: 20, rv20: .60, adx14: 14, pressureDelta: .041, calmDelta: .15, normalDelta: .13 })).toBe(.0375);
  expect(resolvePcsRescueShortDelta({ mode: 'fixed', fixedDelta: 2 })).toBe(.25);
});

test('PCS_RESCUE 自适应极端宽度只切换指定 RISK_ON_EXTENDED/SR02 ADX 桶', () => {
  const common = { profile: 'adx_split_v1' as const, extremeWidthPct: .055, narrowWidthPct: .043, regime: 'RISK_ON_EXTENDED', slowSubregime: 'SR02', vix: 12.5, extremePressure: true };
  expect(resolvePcsRescueExtremeWidth({ extremeWidthPct: .043, regime: 'RISK_ON_EXTENDED', slowSubregime: 'SR02', vix: 12.5, adx14: 25, extremePressure: true })).toBe(.043);
  expect(resolvePcsRescueExtremeWidth({ ...common, adx14: 29.9 })).toBe(.043);
  expect(resolvePcsRescueExtremeWidth({ ...common, adx14: 44 })).toBe(.043);
  expect(resolvePcsRescueExtremeWidth({ ...common, adx14: 35 })).toBe(.055);
  expect(resolvePcsRescueExtremeWidth({ ...common, adx14: undefined })).toBe(.055);
  expect(resolvePcsRescueExtremeWidth({ ...common, regime: 'BULL', adx14: 20 })).toBe(.055);
  expect(resolvePcsRescueExtremeWidth({ ...common, extremePressure: false, adx14: 20 })).toBeUndefined();
});

test('PCS_RESCUE safe uplift 只抬升干净的 RISK_ON_EXTENDED 极端段', () => {
  const common = { mode: 'state_adaptive_quality_v5' as const, extremeDelta: .2425, extremeBaseDelta: .20, extremeFallbackDelta: .18, extremePressure: true };
  expect(resolvePcsRescueShortDelta({ ...common, regime: 'RISK_ON_EXTENDED', vix: 12, rv20: .30, adx14: 25 })).toBe(.2425);
  expect(resolvePcsRescueShortDelta({ ...common, regime: 'RISK_ON_EXTENDED', vix: 12, rv20: .50, adx14: 25 })).toBe(.18);
  expect(resolvePcsRescueShortDelta({ ...common, regime: 'RISK_ON_EXTENDED', vix: 13.5, rv20: .30, adx14: 12 })).toBe(.20);
});

test('PCS_RESCUE range_smart_quality_v26 只在 Calm 边界 OR 条件满足时抬升 Delta', () => {
  const common = { mode: 'range_smart_quality_v26' as const, regime: 'BULL', rv20: .40, adx14: 25, priceVsSma200Pct: .10, calmDelta: .17, normalDelta: .13, pressureDelta: .04 };
  expect(resolvePcsRescueShortDelta({ ...common, vix: 13.4, priceExtensionAtr: 1.40 })).toBe(.17);
  expect(resolvePcsRescueShortDelta({ ...common, vix: 13.7, priceExtensionAtr: 1.30 })).toBe(.15);
  expect(resolvePcsRescueShortDelta({ ...common, vix: 13.7, priceExtensionAtr: 1.20 })).toBe(.17);
});

test('PCS 回测终局在未到期时统一扣除买回佣金，到期时保留 intrinsic 结算', () => {
  const position = { expiry: '2026-08-01', shortStrike: 90, longStrike: 85, width: 5, quantity: 2, creditReceived: 300 };
  const closed = finalizePutCreditSpread({ position, asOfDate: '2026-07-01', qqqClose: 100, vix: 20, pricing: { spreadMultiplier: 1, skewSlope: 0, riskFreeRate: .04 }, commission: 8 });
  expect(closed).toMatchObject({ settled: false, note: '回测结束强制平仓 QQQ Put Credit Spread' });
  const settled = finalizePutCreditSpread({ position: { ...position, expiry: '2026-06-01' }, asOfDate: '2026-07-01', qqqClose: 100, vix: 20, pricing: { spreadMultiplier: 1, skewSlope: 0, riskFreeRate: .04 }, commission: 8 });
  expect(settled).toMatchObject({ settled: true, cashImpact: 0, pnl: 300 });
});

test('PCS 安全门和快速回测时机保持原语义', () => {
  expect(evaluatePutCreditSpreadSafety({ enabled: true, regime: 'BULL', backwardation: false, hasOpenCollar: false, collarTriggered: false, hasOpenPutSpread: false })).toBe(true);
  expect(evaluatePutCreditSpreadSafety({ enabled: true, regime: 'BULL', backwardation: true, hasOpenCollar: false, collarTriggered: false, hasOpenPutSpread: false })).toBe(false);
  expect(evaluatePutCreditSpreadTiming({ mode: 'post_pullback', regime: 'BULL', vix: 20, qqqRoc5: -0.01, pullbackRoc5Ceiling: 0, pullbackVixFloor: 18 })).toBe(true);
  expect(evaluatePutCreditSpreadTiming({ mode: 'reactive_pcs', regime: 'RISK_ON_WEAKENING', vix: 20, qqqRoc5: 0, pullbackRoc5Ceiling: 0, pullbackVixFloor: 18 })).toBe(true);
  expect(evaluatePutCreditSpreadTiming({ mode: 'reactive_pcs', regime: 'BULL', vix: 13.9, qqqRoc5: 0, pullbackRoc5Ceiling: 0, pullbackVixFloor: 18 })).toBe(false);
});

test('PCS 页面评分通过 v2 策略入口保留不可用语义', () => {
  expect(evaluatePutCreditSpreadPageDecision({ mode: 'watch_open', bars: [], vix: 20, vix3m: 22, vxnHistory: [] })).toEqual({ available: false, allowed: false });
});

test('PCS 页面信号只在前序连续天数达到 persistence 门时放行', () => {
  expect(evaluatePutCreditSpreadPageSignal({ mode: 'watch_open', allowed: true, priorStreak: 1, persistDays: 2 })).toEqual({ raw: true, triggered: false });
  expect(evaluatePutCreditSpreadPageSignal({ mode: 'watch_open', allowed: true, priorStreak: 2, persistDays: 2 })).toEqual({ raw: true, triggered: true });
});

test('PCS 连败冷静期按日期门控，解除日当天恢复开仓', () => {
  expect(evaluatePcsStreakCooldownBlocked(undefined, 10, '2026-07-10')).toBe(false);
  expect(evaluatePcsStreakCooldownBlocked({ cooldownUntilDate: '2026-07-11' }, 0, '2026-07-10')).toBe(false);
  expect(evaluatePcsStreakCooldownBlocked({ cooldownUntilDate: '2026-07-11' }, 10, '2026-07-10')).toBe(true);
  expect(evaluatePcsStreakCooldownBlocked({ cooldownUntilDate: '2026-07-10' }, 10, '2026-07-10')).toBe(false);
  expect(evaluatePcsStreakCooldownBlocked({ cooldownUntilDate: '2026-07-09' }, 10, '2026-07-10')).toBe(false);
});

test('PCS 连败冷静期从交易日日历计算，盈利不改变状态', () => {
  const calendar = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-06'];
  expect(updatePcsStreakStateOnClose(undefined, { pnl: -1, closeDate: '2026-07-01', cooldownTradingDays: 2, tradingDayCalendar: calendar })).toEqual({ cooldownUntilDate: '2026-07-03' });
  const state = { cooldownUntilDate: '2026-07-03' };
  expect(updatePcsStreakStateOnClose(state, { pnl: 1, closeDate: '2026-07-02', cooldownTradingDays: 2, tradingDayCalendar: calendar })).toBe(state);
  expect(updatePcsStreakStateOnClose(undefined, { pnl: -1, closeDate: '2026-07-03', cooldownTradingDays: 10, tradingDayCalendar: calendar })).toEqual({ cooldownUntilDate: '2026-07-06' });
});

test('PCS 开仓按 delta、价差宽度与 NAV 风险预算计算', () => {
  const option = (strike: number, delta: number, mid: number) => ({ strike, delta, expiry: '2025-02-07', type: 'put' as const, bid: mid - 0.1, ask: mid + 0.1, iv: 0.2, gamma: 0, theta: 0, openInterest: 1, volume: 1 });
  const result = buildPutCreditSpreadOpen({ chain: { symbol: 'QQQ', spot: 100, timestamp: '', expirations: [{ date: '2025-02-07', calls: [], puts: [option(80, -0.2, 2), option(75, -0.1, 1)] }] }, date: '2025-01-01', targetDte: 37, shortDelta: 0.2, widthPct: 0.02, nav: 100_000, riskBudget: 0.1 });
  expect(result.open).toMatchObject({ shortStrike: 80, longStrike: 75, maxLoss: 420, quantity: 23, riskBudgetUsed: .0966 });
  expect(result.open?.credit).toBeCloseTo(.8);
});

test('研究型 fallback 跳过最近但不可行的到期日，选择 DTE 最近的可行价差', () => {
  const option = (expiry: string, strike: number, delta: number, bid: number, ask: number) => ({ strike, delta, expiry, type: 'put' as const, bid, ask, iv: .2, gamma: 0, theta: 0, openInterest: 1, volume: 1 });
  const chain = { symbol: 'QQQ', spot: 100, timestamp: '', expirations: [
    { date: '2025-02-07', calls: [], puts: [option('2025-02-07', 80, -.2, .6, .7), option('2025-02-07', 75, -.1, .7, .8)] },
    { date: '2025-02-14', calls: [], puts: [option('2025-02-14', 80, -.2, 2, 2.2), option('2025-02-14', 75, -.1, .8, 1.1)] },
  ] };
  const args = { chain, date: '2025-01-01', targetDte: 37, shortDelta: .2, widthPct: .02, nav: 100_000, riskBudget: .1 };
  expect(buildPutCreditSpreadOpen(args).open).toBeUndefined();
  const searched = buildPutCreditSpreadOpenNearestFeasibleExpiry(args).open;
  expect(searched).toMatchObject({ expiry: '2025-02-14', shortStrike: 80, longStrike: 75 });
  expect(searched?.credit).toBeCloseTo(.9);
});

test('PCS σ 生存曲线按日频 σ20 选择最近 OTM 短腿，未设置时保持 delta', () => {
  const option = (strike: number, delta: number, mid: number) => ({ strike, delta, expiry: '2025-02-07', type: 'put' as const, bid: mid - .1, ask: mid + .1, iv: .2, gamma: 0, theta: 0, openInterest: 1, volume: 1 });
  const chain = { symbol: 'QQQ', spot: 100, timestamp: '', expirations: [{ date: '2025-02-07', calls: [], puts: [option(95, -.4, 3), option(90, -.2, 2), option(85, -.1, 1), option(80, -.05, .5)] }] };
  const args = { chain, date: '2025-01-01', targetDte: 37, shortDelta: .2, widthPct: .02, nav: 100_000, riskBudget: .1 };
  expect(buildPutCreditSpreadOpen(args).open?.shortStrike).toBe(90);
  expect(buildPutCreditSpreadOpen({ ...args, shortStrikeSigma: 1.5 as const, dailySigma20: .07 }).open?.shortStrike).toBe(90);
  expect(buildPutCreditSpreadOpen({ ...args, shortStrikeSigma: 2 as const, dailySigma20: .07 }).open?.shortStrike).toBe(85);
});

test('PCS 风险预算买不起 1 张时跳过', () => {
  const option = (strike: number, delta: number, mid: number) => ({ strike, delta, expiry: '2025-02-07', type: 'put' as const, bid: mid - .1, ask: mid + .1, iv: .2, gamma: 0, theta: 0, openInterest: 1, volume: 1 });
  expect(buildPutCreditSpreadOpen({ chain: { symbol: 'QQQ', spot: 100, timestamp: '', expirations: [{ date: '2025-02-07', calls: [], puts: [option(80, -.2, 2), option(75, -.1, 1)] }] }, date: '2025-01-01', targetDte: 37, shortDelta: .2, widthPct: .02, nav: 100, riskBudget: .1 }).open).toBeUndefined();
});

test('FMQ0: PCS 预算不足时强制开 1 张并记录超预算', () => {
  const option = (strike: number, delta: number, mid: number) => ({ strike, delta, expiry: '2025-02-07', type: 'put' as const, bid: mid - .1, ask: mid + .1, iv: .2, gamma: 0, theta: 0, openInterest: 1, volume: 1 });
  const result = buildPutCreditSpreadOpen({ chain: { symbol: 'QQQ', spot: 100, timestamp: '', expirations: [{ date: '2025-02-07', calls: [], puts: [option(80, -.2, 2), option(75, -.1, 1)] }] }, date: '2025-01-01', targetDte: 37, shortDelta: .2, widthPct: .02, nav: 100, riskBudget: .1, forceMinimumContract: true });
  expect(result).toMatchObject({ open: { quantity: 1, riskBudgetUsed: 4.2 }, warning: expect.stringContaining('[FMQ0]强制开1张，超预算4200%') });
});

test('PCS proposal 从开仓结果派生展示字段', () => {
  const option = (strike: number, delta: number, mid: number) => ({ strike, delta, expiry: '2025-02-07', type: 'put' as const, bid: mid - .1, ask: mid + .1, iv: .2, gamma: 0, theta: 0, openInterest: 1, volume: 1 });
  const result = buildPutCreditSpreadProposal({ chain: { symbol: 'QQQ', spot: 100, timestamp: '', expirations: [{ date: '2025-02-07', calls: [], puts: [option(80, -.2, 2), option(75, -.1, 1)] }] }, date: '2025-01-01', targetDte: 37, shortDelta: .2, widthPct: .02, nav: 100_000, riskBudget: .1 });
  expect(result).toMatchObject({ proposal: { proposedStrikes: { spread_short_strike: 80, spread_long_strike: 75 }, metadata: { maxLoss: 420, definedRisk: true } } });
  expect(result.proposal?.metadata.credit).toBeCloseTo(.8);
});

test('PCS 拒绝无效报价，且卖方保费使用 short bid - long ask', () => {
  const option = (strike: number, delta: number, bid: number, ask: number, openInterest = 1) => ({ strike, delta, expiry: '2025-02-07', type: 'put' as const, bid, ask, iv: .2, gamma: 0, theta: 0, openInterest, volume: 1 });
  const base = { symbol: 'QQQ', spot: 100, timestamp: '', expirations: [{ date: '2025-02-07', calls: [], puts: [option(80, -.2, 2, 2.4), option(75, -.1, .8, 1.1)] }] };
  expect(buildPutCreditSpreadOpen({ chain: base, date: '2025-01-01', targetDte: 37, shortDelta: .2, widthPct: .02, nav: 100_000, riskBudget: .1 }).open?.credit).toBeCloseTo(.9);
  const broken = { ...base, expirations: [{ ...base.expirations[0], puts: [option(80, -.2, 2, 1.9), option(75, -.1, .8, 1.1)] }] };
  expect(buildPutCreditSpreadOpen({ chain: broken, date: '2025-01-01', targetDte: 37, shortDelta: .2, widthPct: .02, nav: 100_000, riskBudget: .1 }).open).toBeUndefined();
});

test('研究专用 quote-only protective leg 仅放宽 OI=0 的长腿且保持原宽度', () => {
  const option = (strike: number, delta: number, mid: number, openInterest: number) => ({ strike, delta, expiry: '2025-02-07', type: 'put' as const, bid: mid - .1, ask: mid + .1, iv: .2, gamma: 0, theta: 0, openInterest, volume: 1 });
  const chain = { symbol: 'QQQ', spot: 100, timestamp: '', expirations: [{ date: '2025-02-07', calls: [], puts: [option(80, -.2, 2, 1), option(75, -.1, 1, 0)] }] };
  const args = { chain, date: '2025-01-01', targetDte: 37, shortDelta: .2, widthPct: .02, nav: 100_000, riskBudget: .1 };
  expect(buildPutCreditSpreadOpen(args).open).toBeUndefined();
  expect(buildPutCreditSpreadOpen({ ...args, pairSearchMode: 'quote_only_width_v1' }).open).toMatchObject({ shortStrike: 80, longStrike: 75, maxLoss: 420 });
});

test('研究专用 all-pairs fallback 会在最近保护腿报价无效时寻找更远的有效腿', () => {
  const option = (strike: number, delta: number, bid: number, ask: number) => ({ strike, delta, expiry: '2025-02-07', type: 'put' as const, bid, ask, iv: .2, gamma: 0, theta: 0, openInterest: 1, volume: 1 });
  const chain = { symbol: 'QQQ', spot: 100, timestamp: '', expirations: [{ date: '2025-02-07', calls: [], puts: [
    option(80, -.2, 1, 1.2), option(75, -.1, .8, 1), option(70, -.05, .8, .9),
  ] }] };
  const args = { chain, date: '2025-01-01', targetDte: 37, shortDelta: .2, widthPct: .02, nav: 100_000, riskBudget: .1 };
  expect(buildPutCreditSpreadOpen({ ...args, pairSearchMode: 'nearest_valid_v1' }).open).toBeUndefined();
  const allPairs = buildPutCreditSpreadOpen({ ...args, pairSearchMode: 'nearest_valid_all_pairs_v1' }).open;
  expect(allPairs).toMatchObject({ shortStrike: 80, longStrike: 70, pairSearchUsed: true });
  expect(allPairs?.credit).toBeCloseTo(.1);
  const quoteOnlyChain = { symbol: 'QQQ', spot: 100, timestamp: '', expirations: [{ date: '2025-02-07', calls: [], puts: [
    option(80, -.2, 1, 1.2), option(75, -.1, .4, .5), option(70, -.05, .9, 1.1),
  ] }] };
  const allPairsQuoteOnly = buildPutCreditSpreadOpen({ ...args, chain: quoteOnlyChain, widthPct: .1, pairSearchMode: 'nearest_valid_all_pairs_quote_only_v1' }).open;
  expect(allPairsQuoteOnly).toMatchObject({ shortStrike: 80, longStrike: 75, pairSearchUsed: true });
  expect(allPairsQuoteOnly?.credit).toBeCloseTo(.5);
  const quoteOnlyShort = buildPutCreditSpreadOpen({ ...args, chain: { ...chain, expirations: [{ ...chain.expirations[0], puts: [
    { ...option(80, -.2, 1, 1.2), openInterest: 0 }, option(75, -.1, .4, .5),
  ] }] }, widthPct: .05, pairSearchMode: 'nearest_valid_quote_only_both_width_v1' }).open;
  expect(quoteOnlyShort).toMatchObject({ shortStrike: 80, longStrike: 75, pairSearchUsed: true });
});

test('研究专用 build-recovery Delta 约束不接受高于目标绝对Delta的短腿', () => {
  const option = (strike: number, delta: number, mid: number) => ({ strike, delta, expiry: '2025-02-07', type: 'put' as const, bid: mid - .05, ask: mid + .05, iv: .2, gamma: 0, theta: 0, openInterest: 1, volume: 1 });
  const chain = { symbol: 'QQQ', spot: 100, timestamp: '', expirations: [{ date: '2025-02-07', calls: [], puts: [option(80, -.3, .5), option(75, -.1, .6), option(70, -.05, .2)] }] };
  const args = { chain, date: '2025-01-01', targetDte: 37, shortDelta: .2, widthPct: .05, nav: 100_000, riskBudget: .1 };
  expect(buildPutCreditSpreadOpen({ ...args, pairSearchMode: 'nearest_valid_all_pairs_v1' }).open).toMatchObject({ shortStrike: 80, longStrike: 70 });
  expect(buildPutCreditSpreadOpen({ ...args, pairSearchMode: 'nearest_valid_all_pairs_below_target_delta_v1' }).open).toMatchObject({ shortStrike: 75, longStrike: 70 });
});

test('研究专用最低信用收益率只过滤 fallback pair-search 的低收益价差', () => {
  const option = (strike: number, delta: number, bid: number, ask: number, openInterest: number) => ({ strike, delta, expiry: '2025-02-07', type: 'put' as const, bid, ask, iv: .2, gamma: 0, theta: 0, openInterest, volume: 1 });
  const chain = { symbol: 'QQQ', spot: 100, timestamp: '', expirations: [{ date: '2025-02-07', calls: [], puts: [option(80, -.2, 1, 1.1, 1), option(75, -.1, .4, .5, 0)] }] };
  const args = { chain, date: '2025-01-01', targetDte: 37, shortDelta: .2, widthPct: .05, nav: 100_000, riskBudget: .1, pairSearchMode: 'quote_only_width_v1' as const };
  expect(buildPutCreditSpreadOpen({ ...args, pairSearchMinCreditWidthRatio: .08 }).open).toMatchObject({ shortStrike: 80, longStrike: 75, pairSearchUsed: true });
  expect(buildPutCreditSpreadOpen({ ...args, pairSearchMinCreditWidthRatio: .12 }).open).toBeUndefined();
  expect(buildPutCreditSpreadOpen({ ...args, pairSearchMode: undefined, pairSearchMinCreditWidthRatio: .08 }).open).toBeUndefined();
});

test('PCS 可使用显式最后成交代理计算 credit，没有代理仍拒绝', () => {
  const lastTradeDate = Math.floor(Date.now() / 1000) - 60;
  const option = (strike: number, delta: number, lastPrice?: number) => ({ strike, delta, expiry: '2025-02-07', type: 'put' as const, bid: null, ask: null, lastPrice, lastTradeDate, iv: .2, gamma: 0, theta: 0, openInterest: 1, volume: 1 });
  const chain = (longLast?: number) => ({ symbol: 'QQQ', spot: 100, timestamp: '', expirations: [{ date: '2025-02-07', calls: [], puts: [option(80, -.2, 2), option(75, -.1, longLast)] }] });
  const args = { date: '2025-01-01', targetDte: 37, shortDelta: .2, widthPct: .02, nav: 100_000, riskBudget: .1 };

  const proxied = buildPutCreditSpreadOpen({ ...args, chain: chain(1) as any }).open;
  expect(proxied).toMatchObject({ quoteSource: 'last_trade', quoteAsOf: lastTradeDate, quoteHaircut: .05 });
  expect(proxied?.credit).toBeCloseTo(.85);
  expect(buildPutCreditSpreadOpen({ ...args, chain: chain() as any }).open).toBeUndefined();
});

test('PCS delta 止损优先于止盈', () => {
  const input = { expiry: '2026-12-31', creditReceived: 100, asOfDate: '2026-07-01', regime: 'BULL' as const, daysLeft: 30, shortPutDelta: -0.5, lowPrice: 80, unrealizedPnl: 100, deltaStopEnabled: true, deltaStopThreshold: 0.4, profitTakeEnabled: true, profitTarget: 0.5 };
  expect(evaluatePutCreditSpreadExit(input)).toContain('Δ50%');
});
