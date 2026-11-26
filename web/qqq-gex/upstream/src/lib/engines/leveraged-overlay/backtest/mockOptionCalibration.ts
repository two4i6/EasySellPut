/** 唯一的模拟期权链校准参数源；由 snapshot:calibrate 的输出更新。 */
export const MOCK_OPTION_CALIBRATION = {
  vixToQqqAtmIv: 1.25,
  vxnToQqqAtmIvDivisor: 1.1,
  ivMultiplier: { oneX: 1, doubleX: 1.9, tripleX: 2.9 },
  spreadPct: { oneX: 0.01, doubleX: 0.15, tripleX: 0.08, tqqq: 0.10 },
  liquidity: {
    qqq: { oi: 475, vol: 600, oiDecay: 12, volDecay: 34 },
    tqqq: { oi: 220, vol: 50, oiDecay: 2, volDecay: 6 },
  },
  skewSlope: 2.8 as number,
} as const;
