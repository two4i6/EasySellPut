import { describe, expect, test } from 'bun:test';
import type { FactorMap, FinancialFactor } from '../../../types/factor';
import { createRawFactor, fallbackFactor } from '../../factor';
import {
  buildQqqPcsEntrySnapshot,
  evaluateQqqPcsIntradayTiming,
  QQQ_PCS_SYMBOL,
  type PcsDailyEligibility,
  type QqqPcsEntryFactorMap,
} from './QqqPcsEntrySnapshot';

function raw<T>(value: T, valid: (value: T) => boolean = () => true): FinancialFactor<T> {
  return createRawFactor(value, valid, 'test');
}

function factors(action: PcsDailyEligibility = 'OPEN'): QqqPcsEntryFactorMap {
  return {
    pcs_daily_eligibility: raw(action),
    qqq_intraday_bars_valid: raw(true),
    qqq_intraday_regular_session: raw(true),
    qqq_intraday_data_fresh: raw(true),
    qqq_intraday_vwap: raw(500, (value) => Number.isFinite(value) && value > 0),
    qqq_intraday_price: raw(501, (value) => Number.isFinite(value) && value > 0),
    qqq_intraday_rsi_14: raw(58),
    vxn_change_1d: raw(0),
    vol_premium: raw(1.09),
  };
}

describe('QQQ PCS intraday entry snapshot', () => {
  test('固定 QQQ 且相同输入完全确定', () => {
    const input = factors();
    const first = buildQqqPcsEntrySnapshot(input);
    const second = buildQqqPcsEntrySnapshot(input);
    expect(first.symbol).toBe(QQQ_PCS_SYMBOL);
    expect(QQQ_PCS_SYMBOL).toBe('QQQ');
    expect(first).toEqual(second);
  });

  test('BLOCK 始终是 NO_ENTRY_SIGNAL', () => {
    expect(evaluateQqqPcsIntradayTiming(factors('BLOCK')).value).toBe('NO_ENTRY_SIGNAL');
  });

  test('WATCH 不能输出 NOW', () => {
    expect(evaluateQqqPcsIntradayTiming(factors('WATCH')).value).toBe('WAIT_CONFIRM');
  });

  test('OPEN 但分钟线缺失时 fail closed', () => {
    const input = factors();
    input.qqq_intraday_bars_valid = fallbackFactor(false, '今日分钟线缺失');
    const timing = evaluateQqqPcsIntradayTiming(input);
    expect(timing).toMatchObject({ value: 'INSUFFICIENT_DATA', confidence: 0, source: { type: 'fallback' } });
  });

  test('陈旧数据不得输出 NOW', () => {
    const input = factors();
    input.qqq_intraday_data_fresh = raw(false);
    expect(evaluateQqqPcsIntradayTiming(input).value).toBe('INSUFFICIENT_DATA');
  });

  test('缺 VWAP 或任一必需依赖时不得猜测', () => {
    const input = factors();
    input.qqq_intraday_vwap = fallbackFactor(0, 'VWAP 缺失');
    expect(evaluateQqqPcsIntradayTiming(input)).toMatchObject({
      value: 'INSUFFICIENT_DATA', confidence: 0, source: { type: 'fallback' },
    });
  });

  test('有效原始输入为 raw/10，OPEN 的完整 timing 为 derived NOW', () => {
    const input = factors();
    expect(Object.values(input).every((factor) => factor.source.type === 'raw' && factor.confidence === 10)).toBeTrue();
    const timing = evaluateQqqPcsIntradayTiming(input);
    expect(timing).toMatchObject({ value: 'NOW', source: { type: 'derived' } });
    expect(timing.confidence).toBe(9);
  });

  test('policy 未启用或不可评估时为 INSUFFICIENT_DATA', () => {
    expect(evaluateQqqPcsIntradayTiming(factors('UNAVAILABLE')).value).toBe('INSUFFICIENT_DATA');
  });

  test('OPEN 且实时输入完整时输出 NOW', () => {
    expect(evaluateQqqPcsIntradayTiming(factors('OPEN')).value).toBe('NOW');
  });

  test('VWAP 高于 +0.10% 时不计执行分', () => {
    const input = factors('OPEN');
    input.qqq_intraday_price = raw(500.7, (value) => Number.isFinite(value) && value > 0);
    input.qqq_intraday_rsi_14 = raw(58);
    input.vxn_change_1d = raw(8.3);
    input.vol_premium = raw(1.09);
    const snapshot = buildQqqPcsEntrySnapshot(input);
    expect(snapshot.factors.qqq_pcs_execution_score.value).toBe(3);
  });

  test('输入输出只经 FactorMap 流动', () => {
    const snapshot = buildQqqPcsEntrySnapshot(factors());
    const outputFactors = snapshot.factors as FactorMap;
    expect(outputFactors.qqq_pcs_intraday_timing).toEqual(snapshot.intradayTiming);
  });
});
