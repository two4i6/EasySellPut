'use client';
import { useEffect, useMemo, useState } from 'react';
import type { QqqPcsApiResponse } from '@/types/qqqGex';
import type { QqqExposureReplayContext } from '@/lib/qqqExposureReplay';
import { useQqqIntradayStudy } from '@/hooks/useQqqIntradayStudy';
import { useQqqSpreadQuote } from '@/hooks/useQqqSpreadQuote';
import { qqqSpreadStudy, studyLegQuote, type SpreadSide } from '@/lib/qqqSpreadStudy';
import { useQqqTerminalTabVisible } from '../QqqTerminalWorkspace';
import { QqqObservationEmpty, QqqObservationHeading } from './QqqObservationUi';
import styles from './QqqObservationCards.module.css';
const money = (value: number | null | undefined) => value == null ? '—' : `$${value.toFixed(2)}`;
const age = (value: number | null) => value === null ? '未知' : `${(value / 1000).toFixed(0)}s`;
const clock = new Intl.DateTimeFormat('zh-CN', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

export default function QqqSpreadStudyCard({ data, replay, selectedExpiry }: { data: QqqPcsApiResponse; replay: QqqExposureReplayContext | null; selectedExpiry: string | null }) {
  const visible = useQqqTerminalTabVisible(), study = useQqqIntradayStudy(data, replay, selectedExpiry, visible, false);
  const [side, setSide] = useState<SpreadSide>('put'), [basis, setBasis] = useState<'bidAsk' | 'mid'>('bidAsk'), [shock, setShock] = useState(0), [fees, setFees] = useState('0'), [manual, setManual] = useState('');
  const key = `${study.expiry}:${side}`;
  const [selection, setSelection] = useState<{ key: string; short: number; long: number } | null>(null);
  const strikes = useMemo(() => [...new Set(study.snapshot?.profile.map(row => row.strike).filter(value => Number.isFinite(value) && value > 0) ?? [])].sort((a, b) => a - b), [study.snapshot?.profile]);
  useEffect(() => {
    if (!visible || selection?.key === key || strikes.length < 2 || study.spot === null) return;
    const callIndex = strikes.findIndex(strike => strike >= study.spot!);
    const index = side === 'put' ? Math.max(1, strikes.findLastIndex(strike => strike <= study.spot!)) : Math.min(strikes.length - 2, Math.max(0, callIndex < 0 ? strikes.length - 2 : callIndex));
    setSelection({ key, short: strikes[index], long: strikes[index + (side === 'put' ? -1 : 1)] }); setManual('');
  }, [visible, selection?.key, key, strikes, side, study.spot]);
  const short = selection?.key === key ? selection.short : null, long = selection?.key === key ? selection.long : null;
  const source = study.snapshot?.profile;
  const needsQuote = Boolean(source && short !== null && long !== null && (!studyLegQuote(source.find(row => row.strike === short), side, study.cutoff).valid || !studyLegQuote(source.find(row => row.strike === long), side, study.cutoff).valid));
  const quote = useQqqSpreadQuote(study.date, study.expiry, study.cutoff, short, long, visible && needsQuote);
  const profile = needsQuote && quote.quote ? quote.quote.profile : source;
  const at = needsQuote && quote.quote ? quote.quote.time : study.snapshot?.time;
  const result = useMemo(() => profile && at !== undefined && at !== null && study.expiry && short !== null && long !== null ? qqqSpreadStudy({ profile, expiry: study.expiry, at, cutoff: study.cutoff, spot: study.spot, side, shortStrike: short, longStrike: long, ivShockPp: shock, fees: fees.trim() === '' ? NaN : Number(fees), basis, manualCredit: manual.trim() === '' ? null : Number(manual) }) : null, [profile, at, study.expiry, study.cutoff, study.spot, side, short, long, shock, fees, basis, manual]);
  const liquidity = result?.available ? result : result?.quoteSummary;
  const selectLeg = (leg: 'short' | 'long', value: string) => { if (selection?.key === key) setSelection({ ...selection, [leg]: Number(value) }); };
  const options = (chosen: number | null) => <>{chosen !== null && !strikes.includes(chosen) && <option value={chosen}>{chosen} · 当前缺失</option>}{strikes.map(strike => <option key={strike} value={strike}>{strike}</option>)}</>;
  return <div>
    <QqqObservationHeading title="自选信用价差研究" meta={`${study.date} · ${study.expiry ?? '待到期日'} · 1 组 × 100 股`} info="本页为自选 PCS／CCS 观察，不改变已有开仓资格或选约。切换回放保留所选双腿；历史快照缺报价时按需读取两腿，未生成或补造报价。" />
    <p className={styles.meta}>观察 {Number.isFinite(study.cutoff) ? clock.format(study.cutoff) : '—'} ET · 报价快照 {at != null ? clock.format(at) : '—'} ET</p>
    <div className={styles.studyControls}>
      <label>结构<select aria-label="价差结构" value={side} onChange={event => setSide(event.target.value as SpreadSide)}><option value="put">PCS · Put 信用价差</option><option value="call">CCS · Call 信用价差</option></select></label>
      <label>卖出短腿<select aria-label="卖出短腿" value={short ?? ''} onChange={event => selectLeg('short', event.target.value)}><option value="" disabled>等待行权价</option>{options(short)}</select></label>
      <label>买入长腿<select aria-label="买入长腿" value={long ?? ''} onChange={event => selectLeg('long', event.target.value)}><option value="" disabled>等待行权价</option>{options(long)}</select></label>
    </div>
    {study.preparing && <QqqObservationEmpty>正在整理当前到期日行权价…</QqqObservationEmpty>}
    {quote.loading && <QqqObservationEmpty>正在读取两腿已保存报价…</QqqObservationEmpty>}{quote.error && <QqqObservationEmpty>{quote.error}</QqqObservationEmpty>}
    {!study.snapshot && !study.preparing && <QqqObservationEmpty>当前游标没有可用的完整行权价快照。</QqqObservationEmpty>}
    {needsQuote && quote.quote && (!quote.quote.profile.length || quote.quote.time === null) && <QqqObservationEmpty>游标之前五分钟内未保存这两腿的有效报价。</QqqObservationEmpty>}
    {result && !result.available && <QqqObservationEmpty>{result.reason}</QqqObservationEmpty>}
    {liquidity && <section className={styles.card} aria-label="交易成本与流动性">
      <QqqObservationHeading title="成本与流动性" info="Bid／ask 是保存的报价边界，不能保证成交，无盘口深度、排队或组合订单撮合信息。真实报价时间未知时不标为实时有效；接收年龄相对当前观察游标计算。点差占比为单腿 ask-bid 除以 mid。" />
      <table className={styles.observationTable}><thead><tr><th>腿</th><th>Bid / Ask</th><th>点差%</th><th>报价年龄</th></tr></thead><tbody>{[['短腿', liquidity.short], ['长腿', liquidity.long]].map(([name, value]) => { const leg = value as typeof liquidity.short; return <tr key={String(name)}><td>{String(name)}</td><td>{leg.bid.toFixed(2)} / {leg.ask.toFixed(2)}</td><td>{leg.relativeWidth === null ? '—' : (leg.relativeWidth * 100).toFixed(1)}</td><td>{age(leg.sourceAge)}</td></tr>; })}</tbody></table>
      <p className={styles.meta}>接收年龄：短腿 {age(liquidity.short.receiptAge)}／长腿 {age(liquidity.long.receiptAge)} · {liquidity.liquid ? '双腿报价时间已对齐且在 30 秒内' : '报价时效或同步性未确认'}</p>
      <div className={styles.studyMetrics}><span>卖 Bid／买 Ask 净额<strong>{money(liquidity.conservativeCredit * 100)}</strong></span><span>组合中间价净额<strong>{money(liquidity.midCredit * 100)}</strong></span><span>单程至中价成本<strong>{money(liquidity.midSlippage)}</strong></span><span>报价边界往返成本<strong>{money(liquidity.roundTripFriction)}</strong></span></div>
      <p className={styles.meta}>以上净额／成本按每组美元计算，不含手续费；负净额表示该边界需净支出。</p>
    </section>}
    <section className={styles.card} aria-label="组合价格时间波动率情景">
      <QqqObservationHeading title="组合盈亏情景" info="以当前两腿 mid 净价为锚，叠加 Black–Scholes 双腿重估的价格变化；r=q=0，IV 各腿同时平移。未来平仓净价限制在 0 至价差宽度。到期格子改用内在价值，不包含提前行权、未来流动性或未来买卖点差。不是实际持仓或未来可成交盈亏。" />
      <div className={styles.studyControls}><label>假设入场基准<select aria-label="入场基准" value={basis} onChange={event => setBasis(event.target.value as typeof basis)}><option value="bidAsk">卖 Bid／买 Ask 边界</option><option value="mid">组合中间价</option></select></label><label>自填每股信用金<input aria-label="自填每股信用金" inputMode="decimal" value={manual} placeholder="留空使用报价基准" onChange={event => setManual(event.target.value)} /></label><label>整组往返手续费 $<input aria-label="往返手续费" type="number" min="0" step="0.1" value={fees} onChange={event => setFees(event.target.value)} /></label><label>IV 同时变化<select aria-label="IV 情景变化" value={shock} onChange={event => setShock(Number(event.target.value))}>{[-2, 0, 2].map(value => <option key={value} value={value}>{value > 0 ? '+' : ''}{value} pp</option>)}</select></label></div>
      {result?.available && <><div className={styles.studyMetrics}><span>入场假设净额<strong>{money(result.credit * 100)}</strong></span><span>到期盈亏平衡<strong>{money(result.breakeven)}</strong></span><span>到期最大盈利<strong>{money(result.maxProfit)}</strong></span><span>到期最大亏损<strong>{money(result.maxLoss)}</strong></span></div>
        {result.breakeven === null && <p role="status" className={styles.meta}>手续费超过入场信用金，到期没有盈亏平衡价格。</p>}
        {result.scenarios ? <table className={styles.scenarioTable}><thead><tr><th>价格变化</th><th>现在</th><th>+15m</th><th>+30m</th></tr></thead><tbody>{result.scenarios.map(row => <tr key={row.move}><th>{row.move > 0 ? '+' : ''}{row.move}%</th>{row.cells.map(cell => <td key={cell.minutes} style={{ background: cell.pnl >= 0 ? 'rgba(45,212,191,.12)' : 'rgba(251,113,133,.12)' }} title={`${cell.settled ? '到期内在价值' : '模型锚定净价'} ${money(cell.debit)}／股`}>{money(cell.pnl)}{cell.settled ? '†' : ''}</td>)}</tr>)}</tbody></table> : <QqqObservationEmpty>{result.scenarioReason}</QqqObservationEmpty>}
        {result.greeks && <p className={styles.meta}>每组 Δ {result.greeks.delta.toFixed(2)} · Γ {result.greeks.gamma.toFixed(3)} · Θ {money(result.greeks.theta)}/日 · Vega {money(result.greeks.vega)}/pp</p>}
      </>}
      <p className={styles.meta}>格子为每组美元盈亏；† 为已达所选到期时刻。手续费 {fees || '未填写'} 美元{Number(fees) === 0 ? '（当前未计）' : ''}。</p>
    </section>
    {study.preparationError && <QqqObservationEmpty>{study.preparationError}</QqqObservationEmpty>}
  </div>;
}
