import type { OHLCV } from '../../types/input';
import type { PCSSurvivalTouchConfirmation } from '../../types/params';

export type PcsSurvivalTouchExitInput = {
  confirmation: PCSSurvivalTouchConfirmation;
  openedAt: string;
  shortStrike: number;
  current: Pick<OHLCV, 'date' | 'low' | 'close'>;
  previous?: Pick<OHLCV, 'date' | 'close'>;
  bufferPct: number;
};

/**
 * 纯路径触碰确认规则：不改变开仓，只决定 touch/both 是否产生提前平仓信号。
 * previous 只能作为「开仓之后的上一交易日」使用，避免把开仓前的收盘跌破误算成连续两日。
 */
export function pcsSurvivalTouchExitReason(input: PcsSurvivalTouchExitInput): string | null {
  const { confirmation, openedAt, shortStrike, current, previous } = input;
  if (!(current.date > openedAt) || !(shortStrike > 0)) return null;

  const closeBreach = current.close <= shortStrike;
  const previousCloseBreach = previous !== undefined
    && previous.date > openedAt
    && previous.close <= shortStrike;
  const bufferPct = Number.isFinite(input.bufferPct) ? Math.min(.2, Math.max(0, input.bufferPct)) : .005;
  const bufferedBreach = current.low <= shortStrike * (1 - bufferPct);

  if (confirmation === 'close_confirmation' && closeBreach) {
    return `生存率路径退出：收盘确认短腿跌破 ${current.close.toFixed(2)} ≤ ${shortStrike.toFixed(2)}`;
  }
  if (confirmation === 'two_close_confirmation' && closeBreach && previousCloseBreach) {
    return `生存率路径退出：连续两日收盘跌破短腿（${previous!.close.toFixed(2)} → ${current.close.toFixed(2)}）`;
  }
  if (confirmation === 'buffered_touch' && bufferedBreach) {
    return `生存率路径退出：短腿触碰并跌穿 ${(bufferPct * 100).toFixed(2)}% 缓冲区 ${current.low.toFixed(2)} ≤ ${(shortStrike * (1 - bufferPct)).toFixed(2)}`;
  }
  if (confirmation === 'intraday_touch' && current.low <= shortStrike) {
    return `生存率路径退出：短腿首次盘中触碰 ${current.low.toFixed(2)} ≤ ${shortStrike.toFixed(2)}`;
  }
  return null;
}
