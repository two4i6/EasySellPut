'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { qqqNextAction, type QqqNextActionInput } from '@/lib/qqqNextAction';
import QqqCacheHealth from './QqqCacheHealth';
import useQqqLiveTick from '@/hooks/useQqqLiveTick';
import { qqqClosedSessionDate } from '@/lib/qqqSessionQuote';
import { qqqMarketSession } from '@/lib/qqqMarketSession';
import { useQqqSessionQuote } from '@/hooks/useQqqSessionQuote';
import styles from './QqqNextActionCard.module.css';

export function QqqMarketQuote({ fallbackPrice, now }: { fallbackPrice?: number | null; now: Date | null }) {
  const session = now ? qqqMarketSession(now) : null;
  const sessionLabel = !session ? '确认时段…' : session.premarket ? '盘前' : session.stocksOpen ? '盘中' : session.stockAcquisitionOpen ? '盘后' : '休市';
  const closedDate = now ? qqqClosedSessionDate(now) : null;
  const tick = useQqqLiveTick(Boolean(now) && !closedDate);
  const sessionQuote = useQqqSessionQuote(closedDate);
  const closedQuote = closedDate && sessionQuote?.date === closedDate ? sessionQuote : null;
  const price: number | null = closedDate ? closedQuote?.price ?? null : tick && Number.isFinite(tick.price) ? tick.price : typeof fallbackPrice === 'number' && Number.isFinite(fallbackPrice) ? fallbackPrice : null;
  const change = closedDate ? closedQuote?.change ?? null : Number.isFinite(tick?.change) ? tick!.change! : null;
  const changePercent = closedDate ? closedQuote?.changePercent ?? null : Number.isFinite(tick?.changePercent) ? tick!.changePercent! : null;
  const period = closedDate ? `${closedDate.slice(5).replace('-', '/')} 收盘` : '今日';
  const sign = (value: number) => value > 0 ? '+' : value < 0 ? '−' : '';
  const money = (value: number) => `${sign(value)}$${Math.abs(value).toFixed(2)}`;
  const percent = (value: number) => `${sign(value)}${Math.abs(value).toFixed(2)}%`;
  const tone = change === null || change === 0 ? 'neutral' : change > 0 ? 'positive' : 'negative';
  const accessibleChange = change === null ? `${period}涨跌待报价` : `${period}涨跌 ${money(change)}${changePercent === null ? '' : `，${percent(changePercent)}`}`;
  return <span className={styles.marketQuote} title={closedDate ? `最近交易日 ${closedDate} 收盘；涨跌相对前一交易日收盘（美东日期）` : '当前 QQQ 实时报价；当日变动相对上一收盘'} aria-label={`QQQ ${price === null ? '等待报价' : `当前价格 $${price.toFixed(2)}`}，${accessibleChange}，${sessionLabel}（美东交易时段）`}>
    <span className={styles.marketSymbol}>QQQ</span>
    <strong className={styles.marketPrice} data-tone={tone}>{price === null ? '—' : `$${price.toFixed(2)}`}</strong>
    <span className={styles.marketChange} data-tone={tone}>{closedDate && `${period} · `}{change === null ? closedDate ? '等待行情' : '今日 —' : `${money(change)}${changePercent === null ? '' : ` · ${percent(changePercent)}`}`}</span>
    <span className={styles.marketSession} data-session={sessionLabel} title="按美东时间和交易日历自动更新">{sessionLabel}</span>
  </span>;
}

export default function QqqNextActionCard(props: Omit<QqqNextActionInput, 'now'> & { scope?: 'gex' | 'entry'; compact?: boolean; controls?: ReactNode; endControls?: ReactNode; marketQuote?: boolean; fallbackPrice?: number | null; inputQuality?: string | null; showCompactLinks?: boolean }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const action = now ? qqqNextAction({ ...props, now }) : null;
  const time = action?.checkAt ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(action.checkAt) : null;
  if (props.compact) return <section aria-label={props.marketQuote ? 'QQQ 实时行情与数据状态' : '现在需要做什么'} className={`${styles.card} ${styles.compact} ${props.marketQuote ? styles.marketCompact : ''}`} data-tone={action?.tone ?? 'quiet'}>
    {props.marketQuote ? <QqqMarketQuote fallbackPrice={props.fallbackPrice} now={now} /> : <><span className={styles.label}>QQQ</span><h1 aria-live="polite">{action?.title ?? '正在检查'}</h1></>}
    {props.controls}
    <span className={styles.spacer} />
    {!props.marketQuote && action?.deadline && time && <span className={styles.deadline}>有效至 {time} 北京时间</span>}
    <QqqCacheHealth compact inputQuality={props.inputQuality}><p>{action?.instruction ?? '等待数据就绪。'}</p><p>{action?.next ?? '数据就绪后自动更新。'}</p>{!!action?.levels.length && <p>{action.levels.map(level => `${level.label} ${level.value}`).join(' · ')}</p>}{time && <p>{action?.deadline ? '提示有效至' : '下次检查'} {time}（北京时间）</p>}</QqqCacheHealth>
    {props.showCompactLinks !== false && <nav className={styles.links} aria-label="行动相关页面"><a href="/analysis/qqq#entry-check">开仓检查</a><a href="/analysis/qqq#positions">持仓</a></nav>}
    {props.endControls}
  </section>;
  return <section aria-label="现在需要做什么" className={`${styles.card} ${props.compact ? styles.compact : ''}`} data-tone={action?.tone ?? 'quiet'}>
    <div className={styles.kicker}>QQQ · 下一步 <span>{props.scope === 'gex' ? '盘中研究提示 · 人工复核' : '现有策略检查 · 人工复核'}</span></div>
    <h1 aria-live="polite">{action?.title ?? '正在确认当前状态'}</h1>
    <p>{action?.instruction ?? '稍候，这里会显示现在需要做的事。'}</p>
    {!!action?.levels.length && <div className={styles.levels}>{action.levels.map(level => <span key={level.label}>{level.label} <strong>{level.value}</strong></span>)}</div>}
    <div className={styles.next}><strong>{time ? `${action?.deadline ? '提示有效至' : '下次检查'} ${time}（北京时间）` : '接下来'}</strong><span>{action?.next ?? '数据就绪后自动更新。'}</span></div>
    <nav className={styles.links} aria-label="行动相关页面"><a href="/analysis/qqq#entry-check">查看开仓检查</a><a href="/analysis/qqq#positions">查看策略持仓与到期日</a></nav>
  </section>;
}
