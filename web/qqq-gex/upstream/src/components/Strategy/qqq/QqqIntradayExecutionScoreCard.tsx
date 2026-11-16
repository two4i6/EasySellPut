'use client';

import type { ReactNode } from 'react';
import type { FinancialFactor } from '@/types/factor';
import { QQQ_CS_INTRADAY_RANGE_MAX_POSITION_PCT, QQQ_CS_VWAP_SCORE_MAX_PCT } from '@/lib/engines/analysis/QqqCsEntrySnapshot';
import { QQQ_PCS_VWAP_SCORE_MAX_PCT } from '@/lib/engines/analysis/QqqPcsEntrySnapshot';

export type QqqIntradayExecutionScoreFactor = {
  label: string;
  value: string;
  passed: boolean;
  factor?: FinancialFactor<unknown>;
  tooltip?: ReactNode;
};

type QqqIntradayExecutionScoreCardProps = {
  strategy: 'PCS' | 'CS';
  score: number | null;
  scoreColor: string;
  intradayLow: number | null;
  intradayHigh: number | null;
  intradayPrice: number | null;
  intradayVwap: number | null;
  rangeLabel: string;
  factors: readonly QqqIntradayExecutionScoreFactor[];
  observationOnly?: boolean;
};

export default function QqqIntradayExecutionScoreCard({ strategy, score, scoreColor, intradayLow, intradayHigh, intradayPrice, intradayVwap, rangeLabel, factors, observationOnly = false }: QqqIntradayExecutionScoreCardProps) {
  const hasIntradayRange = intradayLow !== null && intradayHigh !== null && Number.isFinite(intradayLow) && Number.isFinite(intradayHigh) && intradayHigh >= intradayLow;
  const rangePosition = (value: number | null) => value === null || !Number.isFinite(value) || !hasIntradayRange ? null : intradayHigh === intradayLow ? 50 : Math.max(0, Math.min(100, ((value - intradayLow!) / (intradayHigh! - intradayLow!)) * 100));
  const pricePosition = rangePosition(intradayPrice);
  const vwapPosition = rangePosition(intradayVwap);
  const comfortPrice = observationOnly || intradayVwap === null ? null : intradayVwap * (1 + (strategy === 'PCS' ? QQQ_PCS_VWAP_SCORE_MAX_PCT : QQQ_CS_VWAP_SCORE_MAX_PCT) / 100);
  const opportunityStartPosition = strategy === 'CS' && hasIntradayRange ? QQQ_CS_INTRADAY_RANGE_MAX_POSITION_PCT : 0;
  const opportunityWidth = observationOnly || !hasIntradayRange ? null : strategy === 'CS'
    ? 100 - opportunityStartPosition
    : rangePosition(comfortPrice);
  const vwapLabelPosition = vwapPosition === null ? null : Math.max(6, Math.min(94, vwapPosition));

  return <div style={{ borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', marginTop: '0.65rem', paddingTop: '0.65rem' }}>
    <div style={{ marginBottom: '1rem', order: 1 }}>
      <div style={{ alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
        <strong style={{ fontSize: '0.78rem' }}>日内区间 <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>· {rangeLabel}</span></strong>
        <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>低 {intradayLow !== null && Number.isFinite(intradayLow) ? `$${intradayLow.toFixed(2)}` : '—'} · 高 {intradayHigh !== null && Number.isFinite(intradayHigh) ? `$${intradayHigh.toFixed(2)}` : '—'}{!hasIntradayRange && ' · 数据不足'}</span>
      </div>
      <div style={{ background: 'color-mix(in srgb, var(--accent-primary) 18%, var(--bg-secondary))', border: '1px solid color-mix(in srgb, var(--accent-primary) 30%, var(--border-subtle))', borderRadius: 5, height: 12, marginTop: '0.8rem', overflow: 'hidden', position: 'relative' }}>
        {opportunityWidth !== null && opportunityWidth > 0 && <div aria-hidden="true" style={{ background: 'color-mix(in srgb, var(--accent-success) 42%, var(--bg-secondary))', height: '100%', left: `${opportunityStartPosition}%`, position: 'absolute', top: 0, width: `${opportunityWidth}%` }} />}
        {vwapPosition !== null && <span title={`VWAP $${intradayVwap!.toFixed(2)}`} style={{ background: 'var(--accent-warning)', height: 24, left: `${vwapPosition}%`, position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)', width: 3 }} />}
        {pricePosition !== null && <span title={`最新 $${intradayPrice!.toFixed(2)}`} style={{ background: 'var(--bg-card)', border: '4px solid var(--accent-primary)', borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,.24)', height: 20, left: `${pricePosition}%`, position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)', width: 20, zIndex: 1 }} />}
      </div>
      <div style={{ height: 18, marginTop: 6, position: 'relative' }}>
        <span style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: '0.66rem', left: 0, position: 'absolute' }}>日内低</span>
        {vwapLabelPosition !== null && <span style={{ color: 'var(--accent-warning)', fontFamily: 'var(--font-mono)', fontSize: '0.66rem', fontWeight: 800, left: `${vwapLabelPosition}%`, position: 'absolute', transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}> VWAP</span>}
        <span style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: '0.66rem', position: 'absolute', right: 0 }}>日内高</span>
      </div>
    </div>

  </div>;
}
