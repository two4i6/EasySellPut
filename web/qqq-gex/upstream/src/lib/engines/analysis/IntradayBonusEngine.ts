import { createDerivedFactor, fallbackFactor, getFactorValue } from '@/lib/factor';
import type { FactorMap, FinancialFactor } from '@/types/factor';
import type { SellerOpportunityLifecyclePoint } from '@/types/sellerOpportunity';
import type { IntradayBar } from '@/lib/engines/intraday-ladder/types';
import { indicatorEngine } from '@/lib/engines/indicators/IndicatorEngine';

export type IntradayBonusComponents = {
  drawdownPathPoints: number;
  ivrPathPoints: number;
  gexSlopePoints: number;
  rsiPoints: number;
  vwapPoints: number;
};

export type IntradayBonusValue = {
  bonus: number;
  components: IntradayBonusComponents;
  tags: string[];
};

const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
/** 线性 ramp：x≤x0→0，x≥x1→max，中间线性插值。与 SellerEdgeScoreEngine 保持同一模式。 */
const ramp = (x: number, x0: number, x1: number, max: number) => clamp((x - x0) / (x1 - x0) * max, max);
const avg = (values: number[]) => values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;

/** 今天的轮询点数低于此值时数据不足以支撑路径信号，直接 bonus=0。 */
const MIN_LIFECYCLE_POINTS = 3;

const EMPTY_COMPONENTS: IntradayBonusComponents = { drawdownPathPoints: 0, ivrPathPoints: 0, gexSlopePoints: 0, rsiPoints: 0, vwapPoints: 0 };

/** RSI-14 需要至少 period+1 根收盘价才有意义；不足时 calculateRSIWithChange 自身回退到中性 50，天然贡献 0 分。 */
const RSI_PERIOD = 14;

function getNewYorkDateStr(timestamp: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp));
  const y = parts.find(p => p.type === 'year')?.value;
  const m = parts.find(p => p.type === 'month')?.value;
  const d = parts.find(p => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

/**
 * 真分钟线（5m bars）驱动的日内 RSI 分与 VWAP 偏离分。
 * bars 缺失/过少时两个分量都自然退化为 0（不抛错、不拖累其余三个分量）。
 * route.ts 现在按 5d 范围抓取（而非 1d），非交易时段/周末也能拿到"最近一个有效交易日"的真实分钟线；
 * isLive 标记这批 bar 是否真的属于当前纽约日历日，供上层决定要不要打"上一交易日回顾"标签。
 */
function computeRealBarComponents(intradayBars: IntradayBar[] | undefined, currentPrice: number | undefined): { rsiPoints: number; vwapPoints: number; tags: string[]; isLive: boolean } {
  const tags: string[] = [];
  if (!intradayBars || intradayBars.length === 0) return { rsiPoints: 0, vwapPoints: 0, tags, isLive: true };

  // 只取"最近一个有数据的交易日"（最新一根 bar 所在的纽约交易日）的 bar，避免跨日拼接；
  // 5d 范围下这可能是今天，也可能是周末/非交易时段回看到的上一交易日。
  const lastTs = intradayBars.at(-1)!.timestamp;
  const todayDate = getNewYorkDateStr(lastTs);
  const isLive = todayDate === getNewYorkDateStr(new Date().toISOString());
  const todayBars = intradayBars.filter(b => getNewYorkDateStr(b.timestamp) === todayDate);
  if (todayBars.length === 0) return { rsiPoints: 0, vwapPoints: 0, tags, isLive };

  // ── 日内 RSI 分（0-3）：复用 IndicatorEngine.calculateRSIWithChange，喂分钟收盘价而非日收盘价。
  const closes = todayBars.map(b => b.close.value);
  const pricesFactor: FinancialFactor<number[]> = { value: closes, confidence: 10, source: { type: 'raw', api: 'Yahoo 5m bars' } };
  const rsi = indicatorEngine.calculateRSIWithChange(pricesFactor, RSI_PERIOD).current;
  const rsiPoints = ramp(30 - rsi, 0, 20, 3);
  if (rsiPoints > 0) tags.push('INTRADAY_RSI_OVERSOLD');

  // ── VWAP 偏离分（0-3）：口径与 intraday-ladder/pipeline.ts 的 VWAP 计算一致
  // （成交量加权收盘价，非 typical price），保证同一仓库内 VWAP 定义唯一。
  let totalVolume = 0;
  let vwapPV = 0;
  for (const b of todayBars) {
    totalVolume += b.volume.value;
    vwapPV += b.close.value * b.volume.value;
  }
  let vwapPoints = 0;
  if (totalVolume > 0 && currentPrice != null && Number.isFinite(currentPrice)) {
    const vwap = vwapPV / totalVolume;
    if (vwap > 0) {
      const belowVwapPct = ((vwap - currentPrice) / vwap) * 100;
      // 单日 VWAP 折价 3% 顶格：这个仓库其余日内 ramp（如 σ深度、IVR 路径）都是"小额加分、快速顶格"的口径，
      // 单日 VWAP 偏离超过 2-3% 已经是显著折价，3% 封顶避免个别极端日子把这个小分量喂到失真。
      vwapPoints = ramp(belowVwapPct, 0, 3, 3);
    }
  }
  if (vwapPoints > 0) tags.push('BELOW_VWAP');

  return { rsiPoints, vwapPoints, tags, isLive };
}

/**
 * 日内层加分（实验性，默认不计入 score）。
 *
 * 数据来源：既有的 5 分钟轮询快照（engine_minute_bar / readTodayTimeline）驱动 σ深度/IVR路径/GEX斜率三分量；
 * 真分钟线（yahooFinanceServer.getHistorical(symbol, '1d', '5m')）驱动日内 RSI 分与 VWAP 偏离分两个新分量。
 * GEX/斜率在这里是一个用户已裁决的、范围受限的例外（0-21 分 vs 基础分 0-200），不进入 decideSellerOpportunity 的原始输入集合。
 */
/** 旧记录（schema<3 或写入时 GEX/价格因子缺失）没有这些字段；日内层只用完整的点。 */
type CompleteLifecyclePoint = SellerOpportunityLifecyclePoint & {
  price: FinancialFactor<number>;
  ivRank: FinancialFactor<number>;
  totalGex: FinancialFactor<number>;
  gammaFlipLevel: FinancialFactor<number>;
};

function hasIntradayFields(p: SellerOpportunityLifecyclePoint): p is CompleteLifecyclePoint {
  return !!p.price && !!p.ivRank && !!p.totalGex && !!p.gammaFlipLevel;
}

/** 非实时数据（周末/非交易时段回看最近一个有效交易日）打的标签；见 route.ts findRecentTradingDayLifecycle。 */
const PRIOR_SESSION_TAG = 'PRIOR_SESSION_RECAP';

export function computeIntradayBonus(
  factors: FactorMap,
  todayLifecycle: SellerOpportunityLifecyclePoint[],
  intradayBars?: IntradayBar[],
  /** 轮询路径（σ深度/IVR路径/GEX斜率）用的 todayLifecycle 是否确实来自当前交易日；
   *  周末/非交易时段由 route.ts 回看最近一个有效交易日时传 false。默认 true（不改变既有调用方行为）。 */
  isLiveSession: boolean = true,
): FinancialFactor<IntradayBonusValue> {
  const currentPriceForBars = getFactorValue<number>(factors, 'underlying_price');
  const { rsiPoints: rawRsiPoints, vwapPoints: rawVwapPoints, tags: barTags, isLive: barsLive } = computeRealBarComponents(intradayBars, currentPriceForBars);
  const isPriorSession = !isLiveSession || !barsLive;

  const completePoints = todayLifecycle.filter(hasIntradayFields);
  if (completePoints.length < MIN_LIFECYCLE_POINTS) {
    const rsiPoints = Math.round(rawRsiPoints * 10) / 10;
    const vwapPoints = Math.round(rawVwapPoints * 10) / 10;
    const bonus = clamp(rsiPoints + vwapPoints, 21);
    if (bonus === 0) {
      return fallbackFactor({ bonus: 0, components: EMPTY_COMPONENTS, tags: [] }, '日内轮询点不足');
    }
    // 轮询路径三分量不足，但真分钟线驱动的 RSI/VWAP 分量独立可用——两者数据源不同，互不拖累。
    const components: IntradayBonusComponents = { drawdownPathPoints: 0, ivrPathPoints: 0, gexSlopePoints: 0, rsiPoints, vwapPoints };
    const tags = isPriorSession ? [...barTags, PRIOR_SESSION_TAG] : barTags;
    const value: IntradayBonusValue = { bonus, components, tags };
    return createDerivedFactor(value, [{ factorId: 'underlying_price', weight: 1 }], factors);
  }

  // 把当前请求最新鲜的 factors 值作为序列的最后一个点，避免因轮询间隔（≤5 分钟）导致的滞后。
  // 只有真正的实时会话才把"当前 factors 值"追加为序列最后一点（消除轮询间隔滞后）；
  // 上一交易日回顾（isLiveSession=false）时 completePoints 已经是那个交易日的完整序列，
  // 混入当前（可能是周末冻结的同一报价，也可能是次日盘前跳空后的新报价）会让"上一交易日路径"失真。
  const currentPrice = isLiveSession ? getFactorValue<number>(factors, 'underlying_price') : null;
  const currentIvRank = isLiveSession ? getFactorValue<number>(factors, 'iv_rank') : null;
  const currentTotalGex = isLiveSession ? getFactorValue<number>(factors, 'total_gex') : null;
  const currentGammaFlip = isLiveSession ? getFactorValue<number>(factors, 'gamma_flip_level') : null;

  const priceSeries = completePoints.map(p => p.price.value).concat(currentPrice != null ? [currentPrice] : []);
  const ivRankSeries = completePoints.map(p => p.ivRank.value).concat(currentIvRank != null ? [currentIvRank] : []);
  const totalGexSeries = completePoints.map(p => p.totalGex.value).concat(currentTotalGex != null ? [currentTotalGex] : []);
  const gammaFlipSeries = completePoints.map(p => p.gammaFlipLevel.value).concat(currentGammaFlip != null ? [currentGammaFlip] : []);

  // ── 1) σ深度路径分（0-6）────────────────────────────────────────────
  // 与日线 seller_downside_z_1d/3d/5d（进而 SellerEdgeScoreEngine 的 sigmaPoints）同口径：
  // 用今日的 seller_sigma_20 把"跑距当日高点的跌幅"换算成 σ 单位，而非裸百分比，
  // 这样跨标的/跨波动率环境才可比。sigma20 不可用或非正时退化为未归一化的跌幅百分比，不抛错。
  const sigma20 = getFactorValue<number>(factors, 'seller_sigma_20');
  const hasSigma20 = sigma20 != null && Number.isFinite(sigma20) && sigma20 > 0;

  let runningHigh = -Infinity;
  const drawdownFractions = priceSeries.map(price => {
    runningHigh = Math.max(runningHigh, price);
    return runningHigh > 0 ? (runningHigh - price) / runningHigh : 0;
  });
  const sigmaDepths = drawdownFractions.map(fraction => hasSigma20 ? fraction / sigma20! : fraction);

  const currentSigmaDepth = sigmaDepths.at(-1)!;
  const midpoint = Math.max(1, Math.floor(sigmaDepths.length / 2));
  const firstHalfAvg = avg(sigmaDepths.slice(0, midpoint));
  const secondHalfAvg = avg(sigmaDepths.slice(midpoint));
  const deepeningSigma = secondHalfAvg - firstHalfAvg;

  // σ 已归一化：depth 满分对齐日线 sigmaPoints 的 z>=2.5 顶格口径；deepening 满分对齐 1σ 的会话内漂移。
  // sigma20 缺失时退化为原始百分比 ramp（与归一化前的实现一致）。
  const depthPoints = hasSigma20
    ? ramp(currentSigmaDepth, 0, 2.5, 4)
    : ramp(currentSigmaDepth * 100, 0, 5, 4);
  const deepeningPoints = hasSigma20
    ? ramp(deepeningSigma, 0, 1, 2)
    : ramp(deepeningSigma * 100, 0, 3, 2);
  const drawdownPathPoints = clamp(depthPoints + deepeningPoints, 6);

  // ── 2) IVR 路径分（0-5）──────────────────────────────────────────────
  const ivrChange = ivRankSeries.at(-1)! - ivRankSeries[0];
  const ivrPathPoints = ramp(ivrChange, 0, 15, 5);

  // ── 3) GEX 斜率分（0-4）──────────────────────────────────────────────
  const gexFirst = totalGexSeries[0];
  const gexLast = totalGexSeries.at(-1)!;
  const gexScale = Math.abs(gexFirst) > 1e-9 ? Math.abs(gexFirst) : 1;
  const gexSlopePct = (Math.abs(gexLast - gexFirst) / gexScale) * 100;
  const gexSlopePoints = ramp(gexSlopePct, 0, 50, 4);

  const tags: string[] = [...barTags];
  if (drawdownPathPoints > 0) tags.push(hasSigma20 ? 'INTRADAY_SIGMA_DEPTH' : 'INTRADAY_DEEPENING');
  if (ivrPathPoints > 0) tags.push('IVR_RISING_INTRADAY');

  const priceFirst = priceSeries[0];
  const priceLast = priceSeries.at(-1)!;
  const flipFirst = gammaFlipSeries[0];
  const flipLast = gammaFlipSeries.at(-1)!;
  const distFirst = Math.abs(priceFirst - flipFirst);
  const distLast = Math.abs(priceLast - flipLast);
  if (gexSlopePoints > 0 && distLast < distFirst) tags.push('GEX_SLOPE_TOWARD_FLIP');
  if (isPriorSession && !tags.includes(PRIOR_SESSION_TAG)) tags.push(PRIOR_SESSION_TAG);

  const components: IntradayBonusComponents = {
    drawdownPathPoints: Math.round(drawdownPathPoints * 10) / 10,
    ivrPathPoints: Math.round(ivrPathPoints * 10) / 10,
    gexSlopePoints: Math.round(gexSlopePoints * 10) / 10,
    rsiPoints: Math.round(rawRsiPoints * 10) / 10,
    vwapPoints: Math.round(rawVwapPoints * 10) / 10,
  };
  const bonus = clamp(
    components.drawdownPathPoints + components.ivrPathPoints + components.gexSlopePoints
      + components.rsiPoints + components.vwapPoints,
    21,
  );
  const value: IntradayBonusValue = { bonus, components, tags };

  // 权重按各分量满分占比分配（6/5/2/2/3/3，和为 21）：RSI/VWAP 两个新分量都源自当前价格序列（分钟线），
  // 复用 underlying_price 作为依赖因子，不引入合成 factorId。confidence 反映当前 factors 的新鲜度而非硬编码。
  // ⚠语义提醒：这里的 confidence 和这个仓库其它 FinancialFactor 一样，衡量的是"底层输入可信/新鲜到什么程度"，
  // 不是"信号有多强"。bonus=0（五个分量都没触发）时 confidence 完全可能是中高值——这只代表"数据可靠地算出了 0"，
  // 不代表"有一个中等强度的信号"。UI 若要展示这个 confidence，不要和 bonus 的大小混为一谈。
  return createDerivedFactor(value, [
    { factorId: 'underlying_price', weight: (6 + 3 + 3) / 21 },
    { factorId: 'iv_rank', weight: 5 / 21 },
    { factorId: 'total_gex', weight: 2 / 21 },
    { factorId: 'gamma_flip_level', weight: 2 / 21 },
  ], factors);
}
