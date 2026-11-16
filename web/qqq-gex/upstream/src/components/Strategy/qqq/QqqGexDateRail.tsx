'use client';

import { memo } from 'react';
import styles from './QqqGexDateRail.module.css';

function QqqGexDateRail({ dates, selectedDate, onDateSelect, loading, indexLoading, premarketAsOf, compact = false }: { dates: readonly string[]; selectedDate: string | null; onDateSelect: (date: string) => void; loading?: boolean; indexLoading?: boolean; premarketAsOf?: string | null; compact?: boolean }) {
  const availableDates = [...new Set([...dates, ...(selectedDate ? [selectedDate] : [])])].sort().reverse();
  return <label className={`${styles.control} ${compact ? styles.compact : ''}`} title={premarketAsOf ? `当日盘前快照：${premarketAsOf}` : '选择数据库中的 GEX 快照日期'}>
    <span>{compact ? 'GEX' : 'GEX 日期'}</span>
    <select className={premarketAsOf ? styles.withSnapshot : undefined} aria-label="GEX 数据日期" aria-busy={loading || indexLoading || undefined} value={selectedDate ?? ''} disabled={!availableDates.length} onChange={event => { if (event.target.value) onDateSelect(event.target.value); }}>
      {!selectedDate && <option value="" disabled>{indexLoading ? '读取中…' : availableDates.length ? '选择日期' : '暂无快照'}</option>}
      {availableDates.map(date => <option key={date} value={date}>{date}{date === selectedDate && premarketAsOf ? ` · ${premarketAsOf.slice(11, 19)} UTC · 当日盘前` : ''}</option>)}
    </select>
  </label>;
}

export default memo(QqqGexDateRail);
