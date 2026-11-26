import { OHLCVBar, IndicatorSeries } from '../types';

/**
 * K-line Pattern Recognition
 */
export function calculatePatterns(bars: OHLCVBar[]): IndicatorSeries<string | null> {
  const result: IndicatorSeries<string | null> = [];

  for (let i = 0; i < bars.length; i++) {
    const cur = bars[i];
    const prev = i > 0 ? bars[i - 1] : null;
    const prev2 = i > 1 ? bars[i - 2] : null;

    let pattern: string | null = null;

    if (prev) {
      const curBody = Math.abs(cur.close - cur.open);
      const curRange = cur.high - cur.low;
      const prevBody = Math.abs(prev.close - prev.open);
      const prevRange = prev.high - prev.low;

      // Bullish Engulfing
      if (prev.close < prev.open && cur.close > cur.open && cur.open < prev.close && cur.close > prev.open) {
        pattern = 'bullish_engulfing';
      }
      // Bearish Engulfing
      else if (prev.close > prev.open && cur.close < cur.open && cur.open > prev.close && cur.close < prev.open) {
        pattern = 'bearish_engulfing';
      }
      // Hammer
      else if (curRange > 0 && (Math.min(cur.open, cur.close) - cur.low) >= 2 * curBody && (cur.high - Math.max(cur.open, cur.close)) <= 0.5 * curBody) {
        pattern = 'hammer';
      }
      // Shooting Star
      else if (curRange > 0 && (cur.high - Math.max(cur.open, cur.close)) >= 2 * curBody && (Math.min(cur.open, cur.close) - cur.low) <= 0.5 * curBody) {
        pattern = 'shooting_star';
      }
      // Doji
      else if (curRange > 0 && curBody / curRange < 0.1) {
        pattern = 'doji';
      }

      if (prev2 && !pattern) {
        const prev2Body = Math.abs(prev2.close - prev2.open);
        const prev2Range = prev2.high - prev2.low;

        // Morning Star
        if (prev2.close < prev2.open && prev2Body > 0.5 * prev2Range &&
            prevBody < 0.3 * prevRange &&
            cur.close > cur.open && cur.close >= (prev2.open + prev2.close) / 2) {
          pattern = 'morning_star';
        }
        // Evening Star
        else if (prev2.close > prev2.open && prev2Body > 0.5 * prev2Range &&
                 prevBody < 0.3 * prevRange &&
                 cur.close < cur.open && cur.close <= (prev2.open + prev2.close) / 2) {
          pattern = 'evening_star';
        }
        // Three White Soldiers
        else if (cur.close > cur.open && prev.close > prev.open && prev2.close > prev2.open &&
                 cur.close > prev.close && prev.close > prev2.close &&
                 cur.open > prev.open && prev.open > prev2.open) {
          pattern = 'three_white_soldiers';
        }
        // Three Black Crows
        else if (cur.close < cur.open && prev.close < prev.open && prev2.close < prev2.open &&
                 cur.close < prev.close && prev.close < prev2.close &&
                 cur.open < prev.open && prev.open < prev2.open) {
          pattern = 'three_black_crows';
        }
      }
    }

    result.push({
      time: cur.time,
      value: pattern,
      confidence: pattern ? 10 : 0
    });
  }

  return result;
}
