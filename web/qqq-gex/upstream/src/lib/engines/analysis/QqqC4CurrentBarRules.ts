export type QqqC4ReAdmissionRule = 'weakening-1-2-and-trendscore-0-25' | 'weakening-under-2-and-trendscore-0-25' | 'adx-low-trend-low-or-er-high-adx-mid' | 'e36-plus-adx-low-trend-low-or-er-high-adx-mid' | 'e42-plus-adx-mid-current-or-navdd-roc-or-roc5-rsi' | 'e47-plus-f10-four-branch-union' | 'e53-plus-shared-volatility-rsi-adx' | 'e56-plus-adx-lowvol-weakening';

/** Shared observation-only seam; legacy cycle selection remains a compatibility caller. */
export function matchesQqqC4CurrentBarReAdmission(observation: Readonly<Record<string, unknown>>, rule: QqqC4ReAdmissionRule): boolean {
  const cycle = observation;
  const cycleContext = (current: typeof observation) => current;
  const weakeningUnder2AndTrendLow = Number(cycleContext(cycle).weakeningSignalCount) < 2 && Number(cycleContext(cycle).trendScore) < 25;
  const adxLowAndTrendLow = Number(cycleContext(cycle).adx14) < 10 && Number(cycleContext(cycle).trendScore) < 25;
  const erHighAndAdxMid = Number(cycleContext(cycle).qqqEr20) >= .6 && Number(cycleContext(cycle).qqqEr20) < .8
    && Number(cycleContext(cycle).adx14) >= 10 && Number(cycleContext(cycle).adx14) < 15;
  const adxMidCurrent = Number(cycleContext(cycle).adx14) >= 20 && Number(cycleContext(cycle).adx14) < 25 && cycleContext(cycle).slowSubregime === 'CURRENT';
  const navFlatAndRocFlat = Number(cycleContext(cycle).navDrawdownPct) >= 0 && Number(cycleContext(cycle).navDrawdownPct) < .01
    && Number(cycleContext(cycle).tqqqRoc20) >= 0 && Number(cycleContext(cycle).tqqqRoc20) < .03;
  const roc5FlatAndRsiHigh = Number(cycleContext(cycle).roc5) >= -.05 && Number(cycleContext(cycle).roc5) < 0
    && Number(cycleContext(cycle).rsi14) >= 70 && Number(cycleContext(cycle).rsi14) < 100;
  const roc20WeakAndPriceSupported = Number(cycleContext(cycle).roc20) < -.05
    && Number(cycleContext(cycle).priceVsSma200Pct) >= .07 && Number(cycleContext(cycle).priceVsSma200Pct) < .11;
  const erHighAndVixMid = Number(cycleContext(cycle).qqqEr20) >= .6 && Number(cycleContext(cycle).qqqEr20) < .8
    && Number(cycleContext(cycle).vix) >= 19 && Number(cycleContext(cycle).vix) < 22;
  const highVolRsiOrAdx = Number(cycleContext(cycle).tqqqRealisedVol20d) >= .6 && Number(cycleContext(cycle).tqqqRealisedVol20d) < .7
    && ((Number(cycleContext(cycle).rsi14) >= 70 && Number(cycleContext(cycle).rsi14) < 100)
      || (Number(cycleContext(cycle).adx14) >= 40 && Number(cycleContext(cycle).adx14) < 100));

  switch (rule) {
    case 'weakening-1-2-and-trendscore-0-25':
      return Number(cycleContext(cycle).weakeningSignalCount) >= 1 && Number(cycleContext(cycle).weakeningSignalCount) < 2 && Number(cycleContext(cycle).trendScore) < 25;
    case 'weakening-under-2-and-trendscore-0-25':
      return weakeningUnder2AndTrendLow;
    case 'adx-low-trend-low-or-er-high-adx-mid':
      return adxLowAndTrendLow || erHighAndAdxMid;
    case 'e36-plus-adx-low-trend-low-or-er-high-adx-mid':
      return weakeningUnder2AndTrendLow || adxLowAndTrendLow || erHighAndAdxMid;
    case 'e42-plus-adx-mid-current-or-navdd-roc-or-roc5-rsi':
      return weakeningUnder2AndTrendLow || adxLowAndTrendLow || erHighAndAdxMid || adxMidCurrent || navFlatAndRocFlat || roc5FlatAndRsiHigh;
    case 'e47-plus-f10-four-branch-union':
      return weakeningUnder2AndTrendLow || adxLowAndTrendLow || erHighAndAdxMid || adxMidCurrent || navFlatAndRocFlat || roc5FlatAndRsiHigh || roc20WeakAndPriceSupported || erHighAndVixMid || highVolRsiOrAdx;
    case 'e53-plus-shared-volatility-rsi-adx':
      return weakeningUnder2AndTrendLow || adxLowAndTrendLow || erHighAndAdxMid || adxMidCurrent || navFlatAndRocFlat || roc5FlatAndRsiHigh || roc20WeakAndPriceSupported || erHighAndVixMid || highVolRsiOrAdx;
    case 'e56-plus-adx-lowvol-weakening':
      return weakeningUnder2AndTrendLow || adxLowAndTrendLow || erHighAndAdxMid || adxMidCurrent || navFlatAndRocFlat || roc5FlatAndRsiHigh || roc20WeakAndPriceSupported || erHighAndVixMid || highVolRsiOrAdx
        || (Number(cycleContext(cycle).adx14) >= 20 && Number(cycleContext(cycle).adx14) < 25
          && Number(cycleContext(cycle).tqqqRealisedVol20d) >= 0 && Number(cycleContext(cycle).tqqqRealisedVol20d) < .3
          && Number(cycleContext(cycle).weakeningSignalCount) >= 1);
  }
}

