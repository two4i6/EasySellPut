import { expect, test } from "bun:test";
import {
  buildQqqIntradayRsiState,
  buildQqqIntradaySetup,
  buildQqqIntradayTradeMap,
  buildQqqIntradayTradeMapSeries,
  buildQqqShortTermReversalObservations,
  classifyQqqIntradayVolume,
  type QqqIntradayBar,
  type QqqIntradayTradeMap,
  type QqqIntradayVolumeState,
} from "./qqqIntradaySetup";

test("低吸观察保持 1→2→3 的价格、GEX 与 Wall 因果升级", () => {
  const bars: QqqIntradayBar[] = Array.from({ length: 10 }, (_, index) => ({
    time: (index + 1) * 120,
    close: 700 + index * 0.1,
    high: 700.3 + index * 0.1,
    low: 699.8 + index * 0.1,
  }));
  bars.push(
    { time: 1320, close: 699.2, high: 699.6, low: 698.8 },
    { time: 1440, close: 699.4, high: 699.7, low: 699.0 },
    { time: 1560, close: 699.7, high: 699.9, low: 699.2 },
    { time: 1680, close: 700.1, high: 700.3, low: 699.6 },
  );
  const observations = buildQqqShortTermReversalObservations(
    bars,
    [
      { time: 1320, value: -60_000_000 },
      { time: 1560, value: -52_000_000 },
      { time: 1680, value: -48_000_000 },
    ],
    [
      { time: 1320, putWallPrice: 699, callWallPrice: 705 },
      { time: 1680, putWallPrice: 699, callWallPrice: 705 },
    ],
  );
  expect(observations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "BOTTOM",
        state: "WATCH",
        level: 1,
        time: 1320,
      }),
      expect.objectContaining({
        kind: "BOTTOM",
        state: "PRICE_CONFIRMED",
        level: 2,
      }),
      expect.objectContaining({
        kind: "BOTTOM",
        state: "CONFIRMED",
        level: 3,
        time: 1680,
      }),
    ]),
  );
});

test("阶梯式创新低触及 Put Wall 时生成低吸1，不要求一次跌破 0.6 ATR", () => {
  const bars: QqqIntradayBar[] = Array.from({ length: 10 }, (_, index) => ({
    time: (index + 1) * 120,
    close: 671.5 - index * 0.1,
    high: 672 - index * 0.1,
    low: 671 - index * 0.1,
  }));
  bars.push({
    time: 1320,
    close: 670.2,
    high: 670.7,
    low: 669.95,
  });
  const gex = [{ time: 1320, value: -195_000_000 }];

  expect(buildQqqShortTermReversalObservations(bars, gex)).toEqual([]);
  expect(
    buildQqqShortTermReversalObservations(bars, gex, [
      { time: 600, putWallPrice: 670, callWallPrice: 680 },
    ]),
  ).toEqual([]);
  expect(
    buildQqqShortTermReversalObservations(bars, gex, [
      { time: 1320, putWallPrice: 670, callWallPrice: 680 },
    ]),
  ).toEqual([
    expect.objectContaining({
      kind: "BOTTOM",
      state: "WATCH",
      level: 1,
      time: 1320,
      detail: expect.stringContaining("Put Wall"),
    }),
  ]);
});

test("阶梯式创新高触及 Call Wall 时生成逃顶1，不要求一次突破 0.6 ATR", () => {
  const bars: QqqIntradayBar[] = Array.from({ length: 10 }, (_, index) => ({
    time: (index + 1) * 120,
    close: 678.5 + index * 0.1,
    high: 679 + index * 0.1,
    low: 678 + index * 0.1,
  }));
  bars.push({
    time: 1320,
    close: 679.8,
    high: 680.05,
    low: 679.3,
  });
  const gex = [{ time: 1320, value: -95_000_000 }];

  expect(buildQqqShortTermReversalObservations(bars, gex)).toEqual([]);
  expect(
    buildQqqShortTermReversalObservations(bars, gex, [
      { time: 600, putWallPrice: 670, callWallPrice: 680 },
    ]),
  ).toEqual([]);
  expect(
    buildQqqShortTermReversalObservations(bars, gex, [
      { time: 1320, putWallPrice: 670, callWallPrice: 680 },
    ]),
  ).toEqual([
    expect.objectContaining({
      kind: "TOP",
      state: "WATCH",
      level: 1,
      time: 1320,
      detail: expect.stringMatching(/Call Wall.*等待价格转弱/),
    }),
  ]);
});

test("逃顶候选轻微创新高后回落可确认而非失效", () => {
  const bars: QqqIntradayBar[] = Array.from({ length: 10 }, (_, index) => ({
    time: (index + 1) * 120,
    close: 700 - index * 0.1,
    high: 700.2 - index * 0.1,
    low: 699.7 - index * 0.1,
  }));
  bars.push(
    { time: 1320, close: 701.1, high: 701.5, low: 700.8 },
    { time: 1440, close: 701.3, high: 701.62, low: 701.0 },
    { time: 1560, close: 700.9, high: 701.25, low: 700.6 },
    { time: 1680, close: 700.45, high: 700.9, low: 700.2 },
    { time: 1800, close: 699.95, high: 700.45, low: 699.7 },
  );
  const observations = buildQqqShortTermReversalObservations(bars, [
      { time: 1320, value: -50_000_000 },
      { time: 1440, value: -50_000_000 },
      { time: 1680, value: -55_000_000 },
      { time: 1800, value: -58_000_000 },
    ]);
  expect(observations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "TOP", state: "WATCH", time: 1320 }),
      expect.objectContaining({
        kind: "TOP",
        state: "CONFIRMED",
        time: 1680,
      }),
    ]),
  );
  expect(observations).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "TOP", state: "INVALIDATED" }),
    ]),
  );
  expect(
    observations.filter(
      (observation) => observation.kind === "TOP" && observation.level === 1,
    ),
  ).toHaveLength(1);
});

test("逃顶3要求 Call Wall 不向上放开，上移时停留在逃顶2", () => {
  const bars: QqqIntradayBar[] = Array.from({ length: 10 }, (_, index) => ({
    time: (index + 1) * 120,
    close: 700 - index * 0.1,
    high: 700.2 - index * 0.1,
    low: 699.7 - index * 0.1,
  }));
  bars.push(
    { time: 1320, close: 701.1, high: 701.5, low: 700.8 },
    { time: 1440, close: 701.3, high: 701.62, low: 701.0 },
    { time: 1560, close: 700.9, high: 701.25, low: 700.6 },
    { time: 1680, close: 700.45, high: 700.9, low: 700.2 },
  );
  const gex = [
    { time: 1320, value: -50_000_000 },
    { time: 1440, value: -50_000_000 },
    { time: 1680, value: -55_000_000 },
  ];
  const held = buildQqqShortTermReversalObservations(bars, gex, [
    { time: 1320, putWallPrice: 695, callWallPrice: 701.5 },
    { time: 1680, putWallPrice: 695, callWallPrice: 701.5 },
  ]);
  const movedHigher = buildQqqShortTermReversalObservations(bars, gex, [
    { time: 1320, putWallPrice: 695, callWallPrice: 701.5 },
    { time: 1680, putWallPrice: 695, callWallPrice: 702 },
  ]);

  expect(held).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "TOP", state: "CONFIRMED", level: 3 }),
    ]),
  );
  expect(movedHigher).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "TOP",
        state: "PRICE_CONFIRMED",
        level: 2,
        detail: expect.stringContaining("价格先转弱"),
      }),
    ]),
  );
  expect(movedHigher).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "TOP", state: "CONFIRMED", level: 3 }),
    ]),
  );
});

test("低吸候选轻微创新低后反弹可确认而非失效", () => {
  const bars: QqqIntradayBar[] = Array.from({ length: 10 }, (_, index) => ({
    time: (index + 1) * 120,
    close: 700 + index * 0.1,
    high: 700.3 + index * 0.1,
    low: 699.8 + index * 0.1,
  }));
  bars.push(
    { time: 1320, close: 699.2, high: 699.6, low: 698.8 },
    { time: 1440, close: 699.0, high: 699.35, low: 698.68 },
    { time: 1560, close: 699.45, high: 699.7, low: 699.05 },
    { time: 1680, close: 699.95, high: 700.2, low: 699.4 },
  );
  const observations = buildQqqShortTermReversalObservations(bars, [
    { time: 1320, value: -60_000_000 },
    { time: 1440, value: -62_000_000 },
    { time: 1560, value: -55_000_000 },
    { time: 1680, value: -48_000_000 },
  ]);

  expect(observations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "BOTTOM", state: "WATCH", time: 1320 }),
      expect.objectContaining({ kind: "BOTTOM", state: "CONFIRMED" }),
    ]),
  );
  expect(observations).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "BOTTOM", state: "INVALIDATED" }),
    ]),
  );
});

test("明显突破会失效，且新极值立即成为同侧候选", () => {
  const bars: QqqIntradayBar[] = Array.from({ length: 10 }, (_, index) => ({
    time: (index + 1) * 120,
    close: 700 - index * 0.1,
    high: 700.2 - index * 0.1,
    low: 699.7 - index * 0.1,
  }));
  bars.push(
    { time: 1320, close: 701.1, high: 701.5, low: 700.8 },
    { time: 1440, close: 701.9, high: 702.2, low: 701.6 },
  );
  const observations = buildQqqShortTermReversalObservations(bars, [
    { time: 1320, value: -50_000_000 },
    { time: 1440, value: -49_000_000 },
  ]);

  expect(observations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "TOP",
        state: "INVALIDATED",
        time: 1440,
        anchorTime: 1320,
      }),
      expect.objectContaining({
        kind: "TOP",
        state: "WATCH",
        time: 1440,
        anchorTime: 1440,
      }),
    ]),
  );
});

test("确认窗口第4根才满足时仍可确认", () => {
  const bars: QqqIntradayBar[] = Array.from({ length: 10 }, (_, index) => ({
    time: (index + 1) * 120,
    close: 700 + index * 0.1,
    high: 700.3 + index * 0.1,
    low: 699.8 + index * 0.1,
  }));
  bars.push(
    { time: 1320, close: 699.2, high: 699.6, low: 698.8 },
    { time: 1440, close: 699.25, high: 699.5, low: 699.0 },
    { time: 1560, close: 699.3, high: 699.55, low: 699.05 },
    { time: 1680, close: 699.35, high: 699.6, low: 699.1 },
    { time: 1800, close: 699.9, high: 700.1, low: 699.2 },
    { time: 1920, close: 698.5, high: 699.0, low: 698.2 },
  );
  const observations = buildQqqShortTermReversalObservations(bars, [
    { time: 1320, value: -60_000_000 },
    { time: 1800, value: -50_000_000 },
  ]);

  expect(observations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "BOTTOM",
        state: "CONFIRMED",
        time: 1800,
      }),
    ]),
  );
  expect(
    observations.filter(
      (observation) =>
        observation.kind === "BOTTOM" && observation.state === "CONFIRMED",
    ),
  ).toHaveLength(1);
  expect(observations).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "BOTTOM",
        state: "INVALIDATED",
        anchorTime: 1320,
      }),
    ]),
  );
});

test("软重锚后旧 Level2 不推动 Level3，必须重新完成 2→3", () => {
  const baseBars: QqqIntradayBar[] = Array.from(
    { length: 10 },
    (_, index) => ({
      time: (index + 1) * 120,
      close: 700 + index * 0.1,
      high: 700.3 + index * 0.1,
      low: 699.8 + index * 0.1,
    }),
  );
  const bars = [
    ...baseBars,
    { time: 1320, close: 699.2, high: 700.5, low: 698.8 },
    { time: 1440, close: 700.1, high: 700.2, low: 699.0 },
    { time: 1560, close: 700.0, high: 700.0, low: 698.68 },
    { time: 1680, close: 700.05, high: 700.15, low: 698.9 },
    { time: 1800, close: 700.4, high: 700.5, low: 699.0 },
  ];
  const gex = [
    { time: 1320, value: -60_000_000 },
    { time: 1440, value: -58_000_000 },
    { time: 1560, value: -59_000_000 },
    { time: 1680, value: -55_000_000 },
    { time: 1800, value: -50_000_000 },
  ];
  const beforeReconfirmation = buildQqqShortTermReversalObservations(
    bars.slice(0, -1),
    gex,
  );
  expect(beforeReconfirmation).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "BOTTOM",
        state: "PRICE_CONFIRMED",
        time: 1440,
      }),
    ]),
  );
  expect(beforeReconfirmation).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "BOTTOM", state: "CONFIRMED" }),
    ]),
  );

  const afterReconfirmation = buildQqqShortTermReversalObservations(bars, gex);
  expect(afterReconfirmation).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "BOTTOM",
        state: "PRICE_CONFIRMED",
        time: 1800,
      }),
      expect.objectContaining({
        kind: "BOTTOM",
        state: "CONFIRMED",
        time: 1800,
      }),
    ]),
  );
});

test("软重锚后的第4根才满足时仍可确认", () => {
  const bars: QqqIntradayBar[] = Array.from({ length: 10 }, (_, index) => ({
    time: (index + 1) * 120,
    close: 700 + index * 0.1,
    high: 700.3 + index * 0.1,
    low: 699.8 + index * 0.1,
  }));
  bars.push(
    { time: 1320, close: 699.2, high: 699.6, low: 698.8 },
    { time: 1440, close: 699.0, high: 699.35, low: 698.68 },
    { time: 1560, close: 699.1, high: 699.35, low: 698.9 },
    { time: 1680, close: 699.15, high: 699.4, low: 698.95 },
    { time: 1800, close: 699.2, high: 699.45, low: 699.0 },
    { time: 1920, close: 699.7, high: 699.9, low: 699.05 },
  );
  const observations = buildQqqShortTermReversalObservations(bars, [
    { time: 1320, value: -60_000_000 },
    { time: 1440, value: -62_000_000 },
    { time: 1920, value: -50_000_000 },
  ]);

  expect(observations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "BOTTOM",
        state: "CONFIRMED",
        time: 1920,
      }),
    ]),
  );
});

test("确认后10根内不重复同侧 Level1，到边界后恢复", () => {
  const bars: QqqIntradayBar[] = Array.from({ length: 10 }, (_, index) => ({
    time: (index + 1) * 120,
    close: 700 + index * 0.1,
    high: 700.3 + index * 0.1,
    low: 699.8 + index * 0.1,
  }));
  bars.push(
    { time: 1320, close: 699.2, high: 699.6, low: 698.8 },
    { time: 1440, close: 699.4, high: 699.7, low: 699.0 },
    { time: 1560, close: 699.7, high: 699.9, low: 699.2 },
    { time: 1680, close: 700.1, high: 700.3, low: 699.6 },
    { time: 1800, close: 697.0, high: 697.3, low: 696.5 },
    ...Array.from({ length: 8 }, (_, index) => ({
      time: 1920 + index * 120,
      close: 700,
      high: 700.3,
      low: 699.7,
    })),
    { time: 2880, close: 694.5, high: 695.0, low: 693.8 },
  );
  const observations = buildQqqShortTermReversalObservations(bars, [
    { time: 1320, value: -60_000_000 },
    { time: 1680, value: -48_000_000 },
    { time: 2880, value: -45_000_000 },
  ]);
  const bottomLevel1Times = observations
    .filter(
      (observation) =>
        observation.kind === "BOTTOM" && observation.level === 1,
    )
    .map((observation) => observation.time);

  expect(bottomLevel1Times).not.toContain(1800);
  expect(bottomLevel1Times).toEqual([1320, 2880]);
});

test("交易地图保持低位确认、失效位、目标和空间行为", () => {
  const start = Math.floor(
    new Date("2026-07-28T13:30:00.000Z").getTime() / 1000,
  );
  const bars: QqqIntradayBar[] = Array.from({ length: 12 }, (_, index) => ({
    time: start + index * 120,
    close: index === 10 ? 99.8 : index === 11 ? 99.98 : 101.2 - index * 0.08,
    high: index === 11 ? 100.1 : 101.45 - index * 0.08,
    low: index === 10 ? 99.55 : index === 11 ? 99.7 : 100.95 - index * 0.08,
    volume: 100 + index * 5,
  }));
  const map = buildQqqIntradayTradeMap({
    bars,
    vwap: 101,
    putWall: 100,
    callWall: 103,
    gammaFlip: 101.5,
    gex: [
      { time: start + 10 * 120, value: -60_000_000 },
      { time: start + 11 * 120, value: -50_000_000 },
    ],
    observations: [
      {
        kind: "BOTTOM",
        state: "CONFIRMED",
        time: start + 11 * 120,
        anchorTime: start + 8 * 120,
        price: 99.98,
        detail: "确认",
      },
    ],
  });
  expect(map).toEqual(
    expect.objectContaining({
      activeSide: "LOW",
      location: "LOW",
      status: "CONFIRMED",
      target: 101,
    }),
  );
  expect(map!.confirmations.filter((item) => item.passed)).toHaveLength(3);
  expect(map!.invalidation).toBeLessThan(map!.lowZone.lower);
  expect(map!.rewardRisk).toBeGreaterThanOrEqual(1.5);
});

test("高抛链路使用 Call Wall 定位，并由价格、GEX、结构与 RSI 向下确认", () => {
  const start = Math.floor(
    new Date("2026-07-28T13:30:00.000Z").getTime() / 1000,
  );
  const bars: QqqIntradayBar[] = [
    ...Array.from({ length: 10 }, (_, index) => ({
      time: start + index * 120,
      close: 101 + index * 0.2,
      high: 101.2 + index * 0.2,
      low: 100.8 + index * 0.2,
      volume: 100 + index * 5,
    })),
    {
      time: start + 10 * 120,
      close: 103.2,
      high: 103.4,
      low: 103,
      volume: 160,
    },
    {
      time: start + 11 * 120,
      close: 103,
      high: 103.25,
      low: 102.8,
      volume: 170,
    },
  ];
  const confirmedTop = {
    kind: "TOP" as const,
    state: "CONFIRMED" as const,
    level: 3 as const,
    time: start + 11 * 120,
    anchorTime: start + 9 * 120,
    price: 103,
    detail: "逃顶确认",
  };
  const map = buildQqqIntradayTradeMap({
    bars,
    vwap: 101.5,
    putWall: 99,
    callWall: 103,
    gammaFlip: 102,
    gex: [
      { time: start + 10 * 120, value: -50_000_000 },
      { time: start + 11 * 120, value: -55_000_000 },
    ],
    observations: [confirmedTop],
  });

  expect(map).toEqual(
    expect.objectContaining({
      activeSide: "HIGH",
      location: "HIGH",
      status: "CONFIRMED",
    }),
  );
  expect(map!.highZone.sources).toContain("Call墙");
  expect(map!.invalidation).toBeGreaterThan(map!.highZone.upper);
  expect(map!.target).toBeLessThan(map!.spot);
  expect(
    buildQqqIntradaySetup({
      asOf: start + 11 * 120,
      tradeMap: map,
      observations: [confirmedTop],
      rsi: {
        period: 14,
        slopeLookback: 3,
        value: 68,
        slope: -2,
        state: "TURNING_DOWN",
      },
      volume: {
        state: "EXHAUSTION",
        current: 170,
        priorMedian: 100,
        ratio: 1.7,
      },
      context: "ALLOW",
    }),
  ).toEqual(
    expect.objectContaining({
      side: "HIGH",
      stage: "CONFIRMED",
      blockedBy: null,
    }),
  );
});

test("高低位带逐根变化，并且未来 Wall 不会回填到历史 K 线", () => {
  const start = Math.floor(
    new Date("2026-07-28T13:30:00.000Z").getTime() / 1000,
  );
  const bars: QqqIntradayBar[] = Array.from({ length: 14 }, (_, index) => ({
    time: start + index * 120,
    close: 100 + index * 0.12,
    high: 100.28 + index * 0.15,
    low: 99.72 + index * 0.08,
    volume: 100 + index,
  }));
  const vwap = bars.map((bar, index) => ({
    time: bar.time,
    value: 100 + index * 0.06,
  }));
  const wallHistory = [
    {
      time: start,
      putWallPrice: 99.5,
      callWallPrice: 102,
    },
    {
      time: start + 10 * 120,
      putWallPrice: 100.5,
      callWallPrice: 104,
    },
  ];
  const full = buildQqqIntradayTradeMapSeries({
    bars,
    vwap,
    wallHistory,
    gammaFlip: [{ time: start, value: 101 }],
    gex: [],
    observations: [],
  });
  const cutoff = start + 8 * 120;
  const causalPrefix = buildQqqIntradayTradeMapSeries({
    bars: bars.filter((bar) => bar.time <= cutoff),
    vwap: vwap.filter((point) => point.time <= cutoff),
    wallHistory: wallHistory.filter((point) => point.time <= cutoff),
    gammaFlip: [{ time: start, value: 101 }],
    gex: [],
    observations: [],
  });
  const atCutoff = full.find((point) => point.time === cutoff);

  expect(atCutoff?.map.lowZone).toEqual(causalPrefix.at(-1)?.map.lowZone);
  expect(atCutoff?.map.highZone).toEqual(causalPrefix.at(-1)?.map.highZone);
  expect(new Set(full.map((point) => point.map.highZone.anchor)).size).toBeGreaterThan(1);
  expect(full.every((point) => point.map.lowZone.lower < point.map.lowZone.upper)).toBe(true);
  expect(full.every((point) => point.map.highZone.lower < point.map.highZone.upper)).toBe(true);
});

test("RSI14 使用三根斜率识别低位向上拐头", () => {
  const closes = [
    100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 84.5,
    85, 85.5,
  ];
  const state = buildQqqIntradayRsiState(
    closes.map((close, index) => ({ time: index * 120, close })),
  );
  expect(state.period).toBe(14);
  expect(state.slopeLookback).toBe(3);
  expect(state.slope).toBeGreaterThan(0);
  expect(state.state).toBe("TURNING_UP");
});

test("RSI 转向在最近3根内保鲜，超出窗口恢复普通状态", () => {
  const base = [
    100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84,
    84.5, 85, 85.5,
  ];
  const stateFor = (closes: number[]) =>
    buildQqqIntradayRsiState(
      closes.map((close, index) => ({ time: index * 120, close })),
    ).state;

  expect(stateFor([...base, 90, 90, 90])).toBe("TURNING_UP");
  expect(stateFor([...base, 90, 90, 90, 90])).toBe("TURNING_UP");
  expect(stateFor([...base, 90, 90, 90, 90, 90])).toBe("TURNING_UP");
  expect(stateFor([...base, 90, 90, 90, 90, 90, 90])).toBe("NEUTRAL");

  const mirroredBase = base.map((close) => 200 - close);
  expect(stateFor([...mirroredBase, 110, 110, 110])).toBe("TURNING_DOWN");
  expect(stateFor([...mirroredBase, 110, 110, 110, 110])).toBe(
    "TURNING_DOWN",
  );
  expect(stateFor([...mirroredBase, 110, 110, 110, 110, 110])).toBe(
    "TURNING_DOWN",
  );
  expect(stateFor([...mirroredBase, 110, 110, 110, 110, 110, 110])).toBe(
    "NEUTRAL",
  );
});

test("RSI 最新斜率反向时不沿用旧转向", () => {
  const base = [
    100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84,
    84.5, 85, 85.5,
  ];
  const stateFor = (closes: number[]) =>
    buildQqqIntradayRsiState(
      closes.map((close, index) => ({ time: index * 120, close })),
    );

  const turnedUp = stateFor([...base, 90, 90, 90]);
  const reversedDown = stateFor([...base, 90, 90, 90, 89.9]);
  expect(turnedUp.state).toBe("TURNING_UP");
  expect(reversedDown.slope).toBeLessThan(0);
  expect(reversedDown.state).toBe("NEUTRAL");

  const mirroredBase = base.map((close) => 200 - close);
  const turnedDown = stateFor([...mirroredBase, 110, 110, 110]);
  const reversedUp = stateFor([...mirroredBase, 110, 110, 110, 110.1]);
  expect(turnedDown.state).toBe("TURNING_DOWN");
  expect(reversedUp.slope).toBeGreaterThan(0);
  expect(reversedUp.state).toBe("NEUTRAL");
});

const lowMap: QqqIntradayTradeMap = {
  status: "CONFIRMED",
  location: "LOW",
  locationLabel: "低位区",
  spot: 99.5,
  atr: 1,
  lowZone: { lower: 99, upper: 100, anchor: 99.5, sources: ["Put墙"] },
  highZone: { lower: 103, upper: 104, anchor: 103.5, sources: ["Call墙"] },
  activeSide: "LOW",
  confirmations: [],
  invalidation: 98.5,
  target: 103.5,
  rewardRisk: 4,
  guidance: "低位确认",
};

test("Volume 用前十根中位数区分低位放量吸收与有效跌破", () => {
  const prior = Array.from({ length: 10 }, (_, index) => ({
    time: index * 120,
    close: 100,
    low: 99.5,
    high: 100.5,
    volume: 100,
  }));
  const absorption = classifyQqqIntradayVolume(
    [...prior, { time: 1200, close: 99.4, low: 98.8, high: 100, volume: 200 }],
    lowMap,
  );
  const breakout = classifyQqqIntradayVolume(
    [...prior, { time: 1200, close: 98.7, low: 98.5, high: 99.3, volume: 200 }],
    lowMap,
  );
  expect(absorption).toEqual(
    expect.objectContaining({
      state: "ABSORPTION",
      priorMedian: 100,
      ratio: 2,
    }),
  );
  expect(breakout).toEqual(
    expect.objectContaining({ state: "BREAKOUT", priorMedian: 100, ratio: 2 }),
  );
});

test("统一状态机被环境阻断或结构失效时固定 NO_TRADE，且只属于观察层", () => {
  const rsi = {
    period: 14 as const,
    slopeLookback: 3 as const,
    value: 32,
    slope: 1.5,
    state: "TURNING_UP" as const,
  };
  const volume: QqqIntradayVolumeState = {
    state: "ABSORPTION",
    current: 200,
    priorMedian: 100,
    ratio: 2,
  };
  const confirmed = [
    {
      kind: "BOTTOM" as const,
      state: "CONFIRMED" as const,
      level: 3 as const,
      time: 1200,
      anchorTime: 840,
      price: 99.5,
      detail: "确认",
    },
  ];
  const blocked = buildQqqIntradaySetup({
    asOf: 1320,
    tradeMap: lowMap,
    observations: confirmed,
    rsi,
    volume,
    context: "BLOCK",
  });
  const invalidated = buildQqqIntradaySetup({
    asOf: 1320,
    tradeMap: lowMap,
    observations: [
      ...confirmed,
      {
        kind: "BOTTOM",
        state: "INVALIDATED",
        time: 1320,
        anchorTime: 840,
        price: 98.5,
        detail: "失效",
      },
    ],
    rsi,
    volume,
    context: "ALLOW",
  });
  expect(blocked).toEqual(
    expect.objectContaining({
      analysisOnly: true,
      stage: "NO_TRADE",
      blockedBy: "CONTEXT",
    }),
  );
  expect(invalidated).toEqual(
    expect.objectContaining({
      analysisOnly: true,
      stage: "NO_TRADE",
      blockedBy: "INVALIDATED",
    }),
  );
});

test("统一状态机不会让过期反转结构在数小时后继续确认或阻断", () => {
  const rsi = { period: 14 as const, slopeLookback: 3 as const, value: 32, slope: 1.5, state: "TURNING_UP" as const };
  const volume: QqqIntradayVolumeState = { state: "NORMAL", current: 100, priorMedian: 100, ratio: 1 };
  const staleConfirmed = [{ kind: "BOTTOM" as const, state: "CONFIRMED" as const, level: 3 as const, time: 1200, anchorTime: 840, price: 99.5, detail: "旧确认" }];
  const setup = buildQqqIntradaySetup({ asOf: 1200 + 10 * 60 + 1, tradeMap: lowMap, observations: staleConfirmed, rsi, volume, context: "ALLOW" });

  expect(setup).toEqual(expect.objectContaining({ stage: "WATCH", blockedBy: null }));
});
