import { qqqMarketSession } from './qqqMarketSession';
import {
  calculateRSI,
  calculateRSISlope,
} from "./indicators/indicators/momentum";

export type QqqIntradayBar = {
  time: number;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

export type QqqIntradayGexPoint = { time: number; value: number };

export type QqqIntradayWallSnapshot = {
  time: number;
  callWallPrice: number | null;
  putWallPrice: number | null;
};

export type QqqShortTermReversalObservation = {
  kind: "BOTTOM" | "TOP";
  state: "WATCH" | "PRICE_CONFIRMED" | "CONFIRMED" | "INVALIDATED";
  /** 1=极值候选，2=价格止跌/转弱，3=GEX/Wall 共振。 */
  level?: 1 | 2 | 3;
  time: number;
  anchorTime: number;
  price: number;
  detail: string;
};

export type QqqIntradayTradeMap = {
  status: "WATCH" | "CONFIRMED" | "NO_TRADE";
  location: "LOW" | "MIDDLE" | "HIGH" | "OUTSIDE";
  locationLabel: string;
  spot: number;
  atr: number;
  lowZone: { lower: number; upper: number; anchor: number; sources: string[] };
  highZone: { lower: number; upper: number; anchor: number; sources: string[] };
  activeSide: "LOW" | "HIGH" | null;
  confirmations: Array<{ label: string; passed: boolean }>;
  invalidation: number | null;
  target: number | null;
  rewardRisk: number | null;
  guidance: string;
};

export type QqqIntradayTradeMapSeriesPoint = {
  time: number;
  map: QqqIntradayTradeMap;
};

export type QqqIntradayRsiState = {
  period: 14;
  slopeLookback: 3;
  value: number | null;
  slope: number | null;
  state:
    | "UNAVAILABLE"
    | "OVERSOLD"
    | "TURNING_UP"
    | "NEUTRAL"
    | "TURNING_DOWN"
    | "OVERBOUGHT";
};

export type QqqIntradayVolumeState = {
  state: "UNAVAILABLE" | "NORMAL" | "ABSORPTION" | "EXHAUSTION" | "BREAKOUT";
  current: number | null;
  priorMedian: number | null;
  ratio: number | null;
};

export type QqqIntradaySetupResult = {
  analysisOnly: true;
  stage: "NO_TRADE" | "WATCH" | "CANDIDATE" | "CONFIRMED";
  side: "LOW" | "HIGH" | null;
  context: "ALLOW" | "CAUTION" | "BLOCK";
  blockedBy: "MAP" | "INVALIDATED" | "CONTEXT" | "VOLUME_BREAKOUT" | null;
  rsi: QqqIntradayRsiState;
  volume: QqqIntradayVolumeState;
  reasons: string[];
};

const reversalLookbackBars = 10;
const reversalConfirmationBars = 4;
const reversalCooldownBars = 10;
const reversalGexMaxAgeSeconds = 10 * 60;
const reversalSoftExtensionAtr = 0.25;
const reversalHardCloseAtr = 0.15;
const reversalHardWickAtr = 0.35;
const reversalWallProximityRatio = 0.0035;
const easternClockFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  timeZone: "America/New_York",
});
const easternDateFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/New_York",
  year: "numeric",
});
const barLow = (bar: QqqIntradayBar) =>
  Number.isFinite(bar.low) && bar.low! > 0 ? bar.low! : bar.close;
const barHigh = (bar: QqqIntradayBar) =>
  Number.isFinite(bar.high) && bar.high! > 0 ? bar.high! : bar.close;

const ema = (values: readonly number[], period: number) => {
  const alpha = 2 / (period + 1);
  let previous: number | null = null;
  return values.map((value) => {
    previous =
      previous === null ? value : value * alpha + previous * (1 - alpha);
    return previous;
  });
};

const atrAt = (bars: readonly QqqIntradayBar[], index: number, period = 10) => {
  if (index < period) return null;
  const ranges = bars
    .slice(index - period + 1, index + 1)
    .map((bar, offset) => {
      const previousClose =
        index - period + offset > 0
          ? bars[index - period + offset - 1]?.close ?? bar.close
          : bar.close;
      return Math.max(
        barHigh(bar) - barLow(bar),
        Math.abs(barHigh(bar) - previousClose),
        Math.abs(barLow(bar) - previousClose),
      );
    });
  return ranges.every(Number.isFinite)
    ? ranges.reduce((sum, value) => sum + value, 0) / ranges.length
    : null;
};

const easternMinute = (time: number) => {
  const parts = easternClockFormatter.formatToParts(new Date(time * 1000));
  const value = (type: "hour" | "minute") =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return value("hour") * 60 + value("minute");
};

const easternDateKey = (time: number) =>
  easternDateFormatter.format(new Date(time * 1000));

const latestWallAt = (
  wallHistory: readonly QqqIntradayWallSnapshot[],
  time: number,
) => {
  let latest: QqqIntradayWallSnapshot | null = null;
  for (const point of wallHistory) {
    if (!Number.isFinite(point.time) || point.time > time) continue;
    if (latest === null || point.time >= latest.time) latest = point;
  }
  return latest;
};

/**
 * 只使用候选点或最近软重锚之后已收盘的四根 2m bar，以及每根 bar 当时可见的新鲜 GEX/Wall。
 * 结果是研究观察，不产生开仓、平仓或仓位调整指令。
 */
export function buildQqqShortTermReversalObservations(
  inputBars: readonly QqqIntradayBar[],
  gex: readonly QqqIntradayGexPoint[],
  wallHistory: readonly QqqIntradayWallSnapshot[] = [],
): QqqShortTermReversalObservation[] {
  const bars = inputBars
    .filter(
      (bar) =>
        Number.isFinite(bar.time) &&
        Number.isFinite(bar.close) &&
        bar.close > 0,
    )
    .slice()
    .sort((left, right) => left.time - right.time);
  const sortedGex = gex
    .filter(
      (point) => Number.isFinite(point.time) && Number.isFinite(point.value),
    )
    .slice()
    .sort((left, right) => left.time - right.time);
  const smoothedGex = ema(
    sortedGex.map((point) => point.value),
    3,
  );
  const gexAt = (time: number) => {
    const index = sortedGex.findLastIndex((point) => point.time <= time);
    if (index < 0 || time - sortedGex[index]!.time > reversalGexMaxAgeSeconds)
      return null;
    return { ...sortedGex[index]!, smoothed: smoothedGex[index]! };
  };
  const priceEma = ema(
    bars.map((bar) => bar.close),
    3,
  );
  const observations: QqqShortTermReversalObservation[] = [];
  type ReversalKind = QqqShortTermReversalObservation["kind"];
  type ActiveCandidate = {
    kind: ReversalKind;
    originalIndex: number;
    originalBar: QqqIntradayBar;
    originalExtreme: number;
    atr: number;
    referenceIndex: number;
    referenceBar: QqqIntradayBar;
    referenceExtreme: number;
    candidateGex: NonNullable<ReturnType<typeof gexAt>>;
    wallPrice: number | null | undefined;
    referencePriceConfirmed: boolean;
  };
  const active: Partial<Record<ReversalKind, ActiveCandidate>> = {};
  const confirmedCooldownUntil: Partial<Record<ReversalKind, number>> = {};
  const wallContextAt = (
    kind: ReversalKind,
    time: number,
    extreme: number,
  ) => {
    const wall = latestWallAt(wallHistory, time);
    const freshWall =
      wall !== null && time - wall.time <= reversalGexMaxAgeSeconds
        ? wall
        : null;
    const wallPrice =
      kind === "BOTTOM" ? freshWall?.putWallPrice : freshWall?.callWallPrice;
    const nearWall =
      typeof wallPrice === "number" &&
      wallPrice > 0 &&
      Math.abs(extreme / wallPrice - 1) <= reversalWallProximityRatio;
    return { nearWall, wallPrice };
  };

  const startCandidate = (
    kind: ReversalKind,
    index: number,
    candidate: QqqIntradayBar,
    atr: number,
  ) => {
    const candidateGex = gexAt(candidate.time);
    if (candidateGex === null) return false;
    const candidateLow = barLow(candidate);
    const candidateHigh = barHigh(candidate);
    const originalExtreme = kind === "BOTTOM" ? candidateLow : candidateHigh;
    const { nearWall, wallPrice } = wallContextAt(
      kind,
      candidate.time,
      originalExtreme,
    );
    const sideText = kind === "BOTTOM" ? "低吸" : "逃顶";
    active[kind] = {
      kind,
      originalIndex: index,
      originalBar: candidate,
      originalExtreme,
      atr,
      referenceIndex: index,
      referenceBar: candidate,
      referenceExtreme: originalExtreme,
      candidateGex,
      wallPrice,
      referencePriceConfirmed: false,
    };
    observations.push({
      kind,
      state: "WATCH",
      level: 1,
      time: candidate.time,
      anchorTime: candidate.time,
      price: originalExtreme,
      detail: `${sideText}1 · EMA(3) / ATR(10) 过滤 · ${nearWall ? `触及${kind === "BOTTOM" ? " Put" : " Call"} Wall` : "日内有效极值"} · 等待价格${kind === "BOTTOM" ? "止跌" : "转弱"}`,
    });
    return true;
  };

  for (let index = reversalLookbackBars; index < bars.length; index += 1) {
    const candidate = bars[index]!;
    const invalidatedKinds = new Set<ReversalKind>();

    for (const kind of ["BOTTOM", "TOP"] as const) {
      const setup = active[kind];
      if (!setup || index <= setup.referenceIndex) continue;
      const currentExtreme =
        kind === "BOTTOM" ? barLow(candidate) : barHigh(candidate);
      const wickExtension =
        kind === "BOTTOM"
          ? setup.originalExtreme - currentExtreme
          : currentExtreme - setup.originalExtreme;
      const closeExtension =
        kind === "BOTTOM"
          ? setup.originalExtreme - candidate.close
          : candidate.close - setup.originalExtreme;
      const hardInvalidated =
        closeExtension > setup.atr * reversalHardCloseAtr ||
        wickExtension > setup.atr * reversalHardWickAtr;
      const sideText = kind === "BOTTOM" ? "低吸" : "逃顶";
      if (hardInvalidated) {
        observations.push({
          kind,
          state: "INVALIDATED",
          time: candidate.time,
          anchorTime: setup.originalBar.time,
          price: currentExtreme,
          detail: `${sideText}失效 · ${kind === "BOTTOM" ? "向下" : "向上"}突破容差`,
        });
        delete active[kind];
        invalidatedKinds.add(kind);
        continue;
      }

      const extendedReference =
        kind === "BOTTOM"
          ? currentExtreme < setup.referenceExtreme
          : currentExtreme > setup.referenceExtreme;
      if (
        extendedReference &&
        wickExtension <= setup.atr * reversalSoftExtensionAtr
      ) {
        setup.referenceIndex = index;
        setup.referenceBar = candidate;
        setup.referenceExtreme = currentExtreme;
        setup.referencePriceConfirmed = false;
        continue;
      }

      const barsSinceReference = index - setup.referenceIndex;
      if (barsSinceReference > reversalConfirmationBars) {
        delete active[kind];
        continue;
      }

      const formedInitialStructure =
        kind === "BOTTOM"
          ? currentExtreme >= setup.referenceExtreme + setup.atr * 0.1
          : currentExtreme <= setup.referenceExtreme - setup.atr * 0.1;
      const reclaimedEma =
        kind === "BOTTOM"
          ? candidate.close >= priceEma[index]!
          : candidate.close <= priceEma[index]!;
      const recovered =
        kind === "BOTTOM"
          ? candidate.close >= setup.referenceBar.close + setup.atr * 0.25
          : candidate.close <= setup.referenceBar.close - setup.atr * 0.25;
      if (
        !setup.referencePriceConfirmed &&
        formedInitialStructure &&
        reclaimedEma &&
        recovered
      ) {
        setup.referencePriceConfirmed = true;
        observations.push({
          kind,
          state: "PRICE_CONFIRMED",
          level: 2,
          time: candidate.time,
          anchorTime: setup.originalBar.time,
          price: candidate.close,
          detail: `${sideText}2 · 价格先${kind === "BOTTOM" ? "止跌" : "转弱"}：形成初步${kind === "BOTTOM" ? "更高低点" : "更低高点"}，${kind === "BOTTOM" ? "收回" : "跌回"} EMA(3) · GEX 共振尚待确认`,
        });
      }

      const range = Math.max(
        barHigh(setup.referenceBar) - barLow(setup.referenceBar),
        setup.atr * 0.5,
      );
      const formedReversalStructure =
        kind === "BOTTOM"
          ? currentExtreme >= setup.referenceExtreme + setup.atr * 0.2
          : currentExtreme <= setup.referenceExtreme - setup.atr * 0.2;
      const priceReclaimed =
        kind === "BOTTOM"
          ? candidate.close >= setup.referenceExtreme + range && reclaimedEma
          : candidate.close <= setup.referenceExtreme - range && reclaimedEma;
      const confirmationGex = gexAt(candidate.time);
      const gexRelieved =
        confirmationGex !== null &&
        (kind === "BOTTOM"
          ? confirmationGex.smoothed >= setup.candidateGex.smoothed
          : confirmationGex.smoothed <= setup.candidateGex.smoothed);
      const confirmationWall = latestWallAt(wallHistory, candidate.time);
      const confirmationWallPrice =
        kind === "BOTTOM"
          ? confirmationWall?.putWallPrice
          : confirmationWall?.callWallPrice;
      const wallHeld =
        typeof setup.wallPrice !== "number" ||
        typeof confirmationWallPrice !== "number" ||
        (kind === "BOTTOM"
          ? confirmationWallPrice >= setup.wallPrice
          : confirmationWallPrice <= setup.wallPrice);
      if (
        setup.referencePriceConfirmed &&
        formedReversalStructure &&
        priceReclaimed &&
        gexRelieved &&
        wallHeld
      ) {
        observations.push({
          kind,
          state: "CONFIRMED",
          level: 3,
          time: candidate.time,
          anchorTime: setup.originalBar.time,
          price: candidate.close,
          detail: `${sideText}3 · GEX/Wall 共振：形成${kind === "BOTTOM" ? "更高低点" : "更低高点"}，价格穿越 EMA(3)，GEX EMA(3) ${kind === "BOTTOM" ? "未再恶化" : "未再改善"}${setup.wallPrice === undefined || confirmationWallPrice === undefined ? "" : "，Wall 未向不利方向移动"}`,
        });
        confirmedCooldownUntil[kind] = index + reversalCooldownBars;
        delete active[kind];
        continue;
      }

      if (barsSinceReference === reversalConfirmationBars) {
        delete active[kind];
      }
    }

    const previous = bars.slice(
      Math.max(0, index - reversalLookbackBars),
      index,
    );
    const candidateLow = barLow(candidate);
    const candidateHigh = barHigh(candidate);
    const atr = atrAt(bars, index);
    if (atr === null || atr <= 0) continue;
    const previousLow = Math.min(...previous.map(barLow));
    const previousHigh = Math.max(...previous.map(barHigh));
    const strongLow = candidateLow <= previousLow - atr * 0.6;
    const strongHigh = candidateHigh >= previousHigh + atr * 0.6;
    const putWallContext = wallContextAt(
      "BOTTOM",
      candidate.time,
      candidateLow,
    );
    const sweptNearbyPutWall =
      candidateLow <= previousLow &&
      putWallContext.nearWall &&
      typeof putWallContext.wallPrice === "number" &&
      candidateLow <= putWallContext.wallPrice;
    const callWallContext = wallContextAt(
      "TOP",
      candidate.time,
      candidateHigh,
    );
    const sweptNearbyCallWall =
      candidateHigh >= previousHigh &&
      callWallContext.nearWall &&
      typeof callWallContext.wallPrice === "number" &&
      candidateHigh >= callWallContext.wallPrice;
    const isLow = strongLow || sweptNearbyPutWall;
    const isHigh = strongHigh || sweptNearbyCallWall;
    const possibleKinds = [
      ...(isLow ? (["BOTTOM"] as const) : []),
      ...(isHigh ? (["TOP"] as const) : []),
      ...invalidatedKinds,
    ];
    for (const kind of new Set<ReversalKind>(possibleKinds)) {
      if (active[kind]) continue;
      if (
        !invalidatedKinds.has(kind) &&
        confirmedCooldownUntil[kind] !== undefined &&
        index < confirmedCooldownUntil[kind]!
      )
        continue;
      startCandidate(kind, index, candidate, atr);
    }
  }
  return observations.sort((left, right) => left.time - right.time);
}

type TradeMapLevel = { label: string; value: number };

/** 保留现有交易地图行为；只读取截至最后一根已收盘 bar 的数据。 */
export function buildQqqIntradayTradeMap(input: {
  bars: readonly QqqIntradayBar[];
  vwap: number | null;
  putWall: number | null;
  callWall: number | null;
  gammaFlip: number | null;
  gex: readonly QqqIntradayGexPoint[];
  observations: readonly QqqShortTermReversalObservation[];
}): QqqIntradayTradeMap | null {
  const allBars = input.bars
    .filter(
      (bar) =>
        Number.isFinite(bar.time) &&
        Number.isFinite(bar.close) &&
        bar.close > 0,
    )
    .slice()
    .sort((left, right) => left.time - right.time);
  const regularBars = allBars.filter((bar) => {
    return qqqMarketSession(new Date(bar.time * 1000)).stocksOpen;
  });
  const bars = regularBars;
  if (bars.length < 3) return null;
  const lastIndex = bars.length - 1;
  const last = bars[lastIndex]!;
  const previous = bars[lastIndex - 1]!;
  const atr = atrAt(bars, lastIndex, Math.min(10, lastIndex));
  if (atr === null || !Number.isFinite(atr) || atr <= 0) return null;
  const spot = last.close;
  const zoneHalf = Math.max(
    spot * 0.00035,
    Math.min(atr * 0.35, spot * 0.0012),
  );
  const openingEnd = bars[0]!.time + 15 * 60;
  const openingBars = bars.filter((bar) => bar.time <= openingEnd);
  const sessionLow = Math.min(...bars.map(barLow));
  const sessionHigh = Math.max(...bars.map(barHigh));
  const openingLow =
    openingBars.length >= 3 ? Math.min(...openingBars.map(barLow)) : null;
  const openingHigh =
    openingBars.length >= 3 ? Math.max(...openingBars.map(barHigh)) : null;
  const finiteLevel = (label: string, value: number | null): TradeMapLevel[] =>
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? [{ label, value }]
      : [];
  const supportLevels = [
    ...finiteLevel("日内低", sessionLow),
    ...finiteLevel("开盘15低", openingLow),
    ...finiteLevel("VWAP", input.vwap),
    ...finiteLevel("Put墙", input.putWall),
    ...finiteLevel("Flip", input.gammaFlip),
  ];
  const resistanceLevels = [
    ...finiteLevel("日内高", sessionHigh),
    ...finiteLevel("开盘15高", openingHigh),
    ...finiteLevel("VWAP", input.vwap),
    ...finiteLevel("Call墙", input.callWall),
    ...finiteLevel("Flip", input.gammaFlip),
  ];
  const levels = [...supportLevels, ...resistanceLevels];
  const support = supportLevels
    .filter((level) => level.value <= spot + zoneHalf)
    .sort(
      (left, right) =>
        Math.abs(left.value - spot) - Math.abs(right.value - spot),
    )[0] ?? { label: "日内低", value: sessionLow };
  const resistance = resistanceLevels
    .filter(
      (level) =>
        level.value >= spot - zoneHalf &&
        level.value > support.value + zoneHalf * 2,
    )
    .sort(
      (left, right) =>
        Math.abs(left.value - spot) - Math.abs(right.value - spot),
    )[0] ?? { label: "日内高", value: sessionHigh };
  const sourcesNear = (anchor: number) =>
    Array.from(
      new Set(
        levels
          .filter((level) => Math.abs(level.value - anchor) <= zoneHalf * 1.35)
          .map((level) => level.label),
      ),
    );
  const lowZone = {
    lower: support.value - zoneHalf,
    upper: support.value + zoneHalf,
    anchor: support.value,
    sources: sourcesNear(support.value),
  };
  const highZone = {
    lower: resistance.value - zoneHalf,
    upper: resistance.value + zoneHalf,
    anchor: resistance.value,
    sources: sourcesNear(resistance.value),
  };
  const compressed = highZone.lower <= lowZone.upper;
  const inLow = !compressed && spot >= lowZone.lower && spot <= lowZone.upper;
  const inHigh =
    !compressed && spot >= highZone.lower && spot <= highZone.upper;
  const activeSide = inLow
    ? ("LOW" as const)
    : inHigh
      ? ("HIGH" as const)
      : null;
  const recentConfirmed = input.observations.some(
    (observation) =>
      observation.state === "CONFIRMED" &&
      observation.kind === (activeSide === "LOW" ? "BOTTOM" : "TOP") &&
      last.time - observation.time >= 0 &&
      last.time - observation.time <= 10 * 60,
  );
  const priceTurned =
    activeSide === "LOW"
      ? last.close > previous.close &&
        last.close >= (barHigh(last) + barLow(last)) / 2
      : activeSide === "HIGH"
        ? last.close < previous.close &&
          last.close <= (barHigh(last) + barLow(last)) / 2
        : false;
  const recentGex = input.gex
    .filter(
      (point) =>
        point.time <= last.time &&
        last.time - point.time <= reversalGexMaxAgeSeconds,
    )
    .slice(-2);
  const gexTurned =
    recentGex.length >= 2 &&
    (activeSide === "LOW"
      ? recentGex[1]!.value >= recentGex[0]!.value
      : activeSide === "HIGH"
        ? recentGex[1]!.value <= recentGex[0]!.value
        : false);
  const confirmations = [
    { label: "价格转向", passed: priceTurned },
    { label: "GEX缓解", passed: gexTurned },
    { label: "反转结构", passed: recentConfirmed },
  ];
  const confirmationCount = confirmations.filter((item) => item.passed).length;
  const invalidation =
    activeSide === "LOW"
      ? lowZone.lower - atr * 0.35
      : activeSide === "HIGH"
        ? highZone.upper + atr * 0.35
        : null;
  const targetCandidates =
    activeSide === "LOW"
      ? [input.vwap, highZone.anchor].filter(
          (value): value is number =>
            typeof value === "number" && Number.isFinite(value) && value > spot,
        )
      : activeSide === "HIGH"
        ? [input.vwap, lowZone.anchor].filter(
            (value): value is number =>
              typeof value === "number" &&
              Number.isFinite(value) &&
              value < spot,
          )
        : [];
  const target = !targetCandidates.length
    ? null
    : activeSide === "LOW"
      ? Math.min(...targetCandidates)
      : Math.max(...targetCandidates);
  const risk = invalidation === null ? null : Math.abs(spot - invalidation);
  const rewardRisk =
    target === null || risk === null || risk <= 0
      ? null
      : Math.abs(target - spot) / risk;
  const location: QqqIntradayTradeMap["location"] = inLow
    ? "LOW"
    : inHigh
      ? "HIGH"
      : spot < lowZone.lower || spot > highZone.upper
        ? "OUTSIDE"
        : "MIDDLE";
  const locationLabel = compressed
    ? "区间过窄"
    : location === "LOW"
      ? "低位区"
      : location === "HIGH"
        ? "高位区"
        : location === "OUTSIDE"
          ? "区间外"
          : "中段";
  const hasRoom = rewardRisk !== null && rewardRisk >= 1.5;
  const status: QqqIntradayTradeMap["status"] =
    activeSide === null || compressed || !hasRoom
      ? "NO_TRADE"
      : confirmationCount >= 2
        ? "CONFIRMED"
        : "WATCH";
  const guidance = compressed
    ? "高低位重叠 · 等区间扩展"
    : activeSide === null
      ? location === "OUTSIDE"
        ? "脱离价带 · 等回踩/反抽"
        : "高低位之间 · 不追"
      : !hasRoom
        ? "到目标空间不足 · 不做"
        : status === "CONFIRMED"
          ? `${activeSide === "LOW" ? "低位" : "高位"}确认 ${confirmationCount}/3 · 等小回踩`
          : `${activeSide === "LOW" ? "低位" : "高位"}观察 ${confirmationCount}/3 · 等确认`;
  return {
    status,
    location,
    locationLabel,
    spot,
    atr,
    lowZone,
    highZone,
    activeSide,
    confirmations,
    invalidation,
    target,
    rewardRisk,
    guidance,
  };
}

/**
 * 为每根已收盘 K 线重建当时可见的交易地图。K 线按美东交易日隔离，
 * VWAP、GEX、Gamma Flip 与 Wall 均只取 point.time <= bar.time 的历史，
 * 用于绘制会随盘中结构移动、且不含未来数据的高低位带。
 */
export function buildQqqIntradayTradeMapSeries(input: {
  bars: readonly QqqIntradayBar[];
  vwap: readonly QqqIntradayGexPoint[];
  wallHistory: readonly QqqIntradayWallSnapshot[];
  gammaFlip: readonly QqqIntradayGexPoint[];
  gex: readonly QqqIntradayGexPoint[];
  observations: readonly QqqShortTermReversalObservation[];
}): QqqIntradayTradeMapSeriesPoint[] {
  const bars = input.bars
    .filter(
      (bar) =>
        Number.isFinite(bar.time) &&
        Number.isFinite(bar.close) &&
        bar.close > 0,
    )
    .slice()
    .sort((left, right) => left.time - right.time);
  const timedValues = (values: readonly QqqIntradayGexPoint[]) =>
    values
      .filter(
        (point) => Number.isFinite(point.time) && Number.isFinite(point.value),
      )
      .slice()
      .sort((left, right) => left.time - right.time);
  const vwap = timedValues(input.vwap);
  const gammaFlip = timedValues(input.gammaFlip);
  const gex = timedValues(input.gex);
  const walls = input.wallHistory
    .filter((point) => Number.isFinite(point.time))
    .slice()
    .sort((left, right) => left.time - right.time);
  const latestValueAt = (
    values: readonly QqqIntradayGexPoint[],
    time: number,
  ) => {
    const point = values.findLast((candidate) => candidate.time <= time);
    return point?.value ?? null;
  };
  const sessionBars = new Map<string, QqqIntradayBar[]>();
  const result: QqqIntradayTradeMapSeriesPoint[] = [];

  for (const bar of bars) {
    if (!qqqMarketSession(new Date(bar.time * 1000)).stocksOpen) continue;
    const dateKey = easternDateKey(bar.time);
    const currentBars = sessionBars.get(dateKey) ?? [];
    currentBars.push(bar);
    sessionBars.set(dateKey, currentBars);
    const wall = latestWallAt(walls, bar.time);
    const map = buildQqqIntradayTradeMap({
      bars: currentBars,
      vwap: latestValueAt(vwap, bar.time),
      putWall: wall?.putWallPrice ?? null,
      callWall: wall?.callWallPrice ?? null,
      gammaFlip: latestValueAt(gammaFlip, bar.time),
      gex: gex.filter((point) => point.time <= bar.time),
      observations: input.observations.filter(
        (observation) => observation.time <= bar.time,
      ),
    });
    if (map !== null) result.push({ time: bar.time, map });
  }
  return result;
}

/** RSI14 与三根 bar 斜率；只基于传入的已收盘 bar。 */
export function buildQqqIntradayRsiState(
  inputBars: readonly QqqIntradayBar[],
): QqqIntradayRsiState {
  const bars = inputBars
    .filter(
      (bar) =>
        Number.isFinite(bar.time) &&
        Number.isFinite(bar.close) &&
        bar.close > 0,
    )
    .slice()
    .sort((left, right) => left.time - right.time);
  const rsiSeries = calculateRSI(
    bars.map((bar) => bar.close),
    bars.map((bar) => bar.time),
    14,
  );
  const slopeSeries = calculateRSISlope(rsiSeries, 3);
  const latest = rsiSeries.at(-1)?.value ?? null;
  const slope = slopeSeries.at(-1)?.value ?? null;
  const rawStateAt = (index: number): QqqIntradayRsiState["state"] => {
    const value = rsiSeries[index]?.value ?? null;
    const valueSlope = slopeSeries[index]?.value ?? null;
    const previous = rsiSeries[index - 3]?.value ?? null;
    return value === null || valueSlope === null
      ? "UNAVAILABLE"
      : valueSlope > 0 &&
          (value <= 40 || (previous !== null && previous <= 35))
        ? "TURNING_UP"
        : valueSlope < 0 &&
            (value >= 60 || (previous !== null && previous >= 65))
          ? "TURNING_DOWN"
          : value <= 35
            ? "OVERSOLD"
            : value >= 65
              ? "OVERBOUGHT"
              : "NEUTRAL";
  };
  const latestIndex = rsiSeries.length - 1;
  const rawState = rawStateAt(latestIndex);
  const freshTurn = [latestIndex, latestIndex - 1, latestIndex - 2]
    .filter((index) => index >= 0)
    .map(rawStateAt)
    .find((state) => state === "TURNING_UP" || state === "TURNING_DOWN");
  const freshTurnAgreesWithLatestSlope =
    (freshTurn === "TURNING_UP" && slope !== null && slope >= 0) ||
    (freshTurn === "TURNING_DOWN" && slope !== null && slope <= 0);
  const state =
    rawState === "NEUTRAL" && freshTurnAgreesWithLatestSlope
      ? freshTurn!
      : rawState;
  return { period: 14, slopeLookback: 3, value: latest, slope, state };
}

const median = (values: readonly number[]) => {
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
};

/** 最新 bar 相对前十根有效成交量中位数分类；不会读取未来成交量。 */
export function classifyQqqIntradayVolume(
  inputBars: readonly QqqIntradayBar[],
  tradeMap: QqqIntradayTradeMap | null,
): QqqIntradayVolumeState {
  const bars = inputBars
    .filter(
      (bar) =>
        Number.isFinite(bar.time) &&
        Number.isFinite(bar.close) &&
        bar.close > 0,
    )
    .slice()
    .sort((left, right) => left.time - right.time);
  const latest = bars.at(-1);
  const priorVolumes = bars
    .slice(-11, -1)
    .map((bar) => bar.volume)
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value) && value > 0,
    );
  if (
    !latest ||
    typeof latest.volume !== "number" ||
    !Number.isFinite(latest.volume) ||
    latest.volume <= 0 ||
    priorVolumes.length < 10
  ) {
    return {
      state: "UNAVAILABLE",
      current: latest?.volume ?? null,
      priorMedian: null,
      ratio: null,
    };
  }
  const priorMedian = median(priorVolumes);
  const ratio = priorMedian > 0 ? latest.volume / priorMedian : null;
  if (ratio === null || tradeMap?.activeSide === null || tradeMap === null) {
    return { state: "NORMAL", current: latest.volume, priorMedian, ratio };
  }
  const elevated = ratio >= 1.5;
  const quiet = ratio <= 0.65;
  let state: QqqIntradayVolumeState["state"] = "NORMAL";
  if (tradeMap.activeSide === "LOW") {
    if (elevated && latest.close < tradeMap.lowZone.lower) state = "BREAKOUT";
    else if (
      elevated &&
      barLow(latest) < tradeMap.lowZone.lower &&
      latest.close >= tradeMap.lowZone.lower
    )
      state = "ABSORPTION";
    else if (quiet && latest.close <= tradeMap.lowZone.upper)
      state = "EXHAUSTION";
  } else {
    if (elevated && latest.close > tradeMap.highZone.upper) state = "BREAKOUT";
    else if (
      elevated &&
      barHigh(latest) > tradeMap.highZone.upper &&
      latest.close <= tradeMap.highZone.upper
    )
      state = "EXHAUSTION";
    else if (quiet && latest.close >= tradeMap.highZone.lower)
      state = "ABSORPTION";
  }
  return { state, current: latest.volume, priorMedian, ratio };
}

/**
 * 观察层唯一 setup 状态机。它不接入 FactorMap/VerdictEngine/DecisionEngine，不能产生订单。
 */
export function buildQqqIntradaySetup(input: {
  asOf: number;
  tradeMap: QqqIntradayTradeMap | null;
  observations: readonly QqqShortTermReversalObservation[];
  rsi: QqqIntradayRsiState;
  volume: QqqIntradayVolumeState;
  context: "ALLOW" | "CAUTION" | "BLOCK";
}): QqqIntradaySetupResult {
  const { tradeMap, rsi, volume, context } = input;
  const side = tradeMap?.activeSide ?? null;
  const kind = side === "LOW" ? "BOTTOM" : side === "HIGH" ? "TOP" : null;
  const freshObservations = kind === null || !Number.isFinite(input.asOf)
    ? []
    : input.observations
        .filter((observation) => observation.kind === kind
          && observation.time <= input.asOf
          && observation.anchorTime <= input.asOf
          && input.asOf - observation.time <= reversalGexMaxAgeSeconds)
        .sort((left, right) => left.anchorTime - right.anchorTime || left.time - right.time);
  const latestAnchorTime = freshObservations.at(-1)?.anchorTime ?? null;
  const latestObservation = latestAnchorTime === null
    ? null
    : freshObservations.filter((observation) => observation.anchorTime === latestAnchorTime).at(-1) ?? null;
  const base = { analysisOnly: true as const, side, context, rsi, volume };

  if (tradeMap === null || tradeMap.status === "NO_TRADE" || side === null) {
    return {
      ...base,
      stage: "NO_TRADE",
      blockedBy: "MAP",
      reasons: ["位置、空间或交易地图未满足"],
    };
  }
  if (latestObservation?.state === "INVALIDATED") {
    return {
      ...base,
      stage: "NO_TRADE",
      blockedBy: "INVALIDATED",
      reasons: ["反转结构已失效"],
    };
  }
  if (context === "BLOCK") {
    return {
      ...base,
      stage: "NO_TRADE",
      blockedBy: "CONTEXT",
      reasons: ["GEX 环境阻断均值回归"],
    };
  }
  if (volume.state === "BREAKOUT") {
    return {
      ...base,
      stage: "NO_TRADE",
      blockedBy: "VOLUME_BREAKOUT",
      reasons: ["成交量确认继续突破"],
    };
  }

  const rsiTurned =
    side === "LOW" ? rsi.state === "TURNING_UP" : rsi.state === "TURNING_DOWN";
  const priceConfirmed =
    latestObservation?.state === "PRICE_CONFIRMED" ||
    latestObservation?.state === "CONFIRMED";
  const structureConfirmed = latestObservation?.state === "CONFIRMED";
  if (structureConfirmed && rsiTurned) {
    return {
      ...base,
      stage: "CONFIRMED",
      blockedBy: null,
      reasons: [
        "位置成立",
        "价格与 RSI 转向",
        "GEX/Wall 共振",
        "成交量未确认突破",
      ],
    };
  }
  if (priceConfirmed && rsiTurned) {
    return {
      ...base,
      stage: "CANDIDATE",
      blockedBy: null,
      reasons: ["位置成立", "价格与 RSI 转向", "等待 GEX/Wall 共振"],
    };
  }
  return {
    ...base,
    stage: "WATCH",
    blockedBy: null,
    reasons: ["位置成立", "等待价格、RSI 与结构确认"],
  };
}
