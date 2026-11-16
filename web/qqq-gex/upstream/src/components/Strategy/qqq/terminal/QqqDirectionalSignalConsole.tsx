'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { directionalSignalPresentation } from './directionalSignalPresentation';
import { qqqMarketSession } from '@/lib/qqqMarketSession';
import styles from './QqqDirectionalSignalConsole.module.css';
import QqqDirectionalResearchOverview from './QqqDirectionalResearchOverview';
import type { QqqPcsApiResponse } from '@/types/qqqGex';
import type { QqqIntradayDirectionalDecision } from '@/lib/engines/analysis/QqqIntradayDirectional';
import type {
  QqqIntradayDirectionalReplaySignal,
} from '@/lib/engines/analysis/QqqIntradayDirectionalReplay';

import type { QqqDirectionalReplayApiResponse } from '@/types/qqqGex';
export type { QqqDirectionalReplayApiResponse } from '@/types/qqqGex';

type Directional = NonNullable<NonNullable<QqqPcsApiResponse['intraday']>['directional']>;
type DisplaySignal = QqqIntradayDirectionalDecision | QqqIntradayDirectionalReplaySignal;

const ALERTS_KEY = 'qqqDirectionalAlertsEnabled';
const LAST_SIGNAL_KEY = 'qqqDirectionalLastSignalId';
const reasonLabels: Record<string, string> = {
  OUTSIDE_ALERT_WINDOW: '当前不在 10:00–16:00 ET 提醒窗口', BAR_DATA_STALE: '2 分钟 K 线超过 4 分钟未更新',
  GEX_DATA_STALE: 'GEX 超过 6 分钟未更新', NOT_ENOUGH_BARS: '当日不足 15 根已收盘 K 线',
  PARTIAL_GEX_INPUT: 'GEX 使用有效 OI／IV 子集，完整链交易确认暂不可用',
  NOT_ENOUGH_EXPIRIES: '有效到期日少于 2 个', MISSING_GEX_STRUCTURE: 'GEX / Wall / Gamma Flip 结构不完整',
  TRANSITION_REGIME: 'VWAP 与 EMA20 斜率不一致，处于过渡状态', NO_CONFLUENT_ZONE: '不足两个价位形成交易区',
  NO_SWEEP_RECLAIM: '尚未完成扫位后收回', NO_TREND_RECLAIM: '尚未完成顺势回踩收回',
  RSI_NOT_TURNING: 'RSI14 三根斜率尚未转向', VOLUME_CONFIRMS_BREAKOUT: '成交量达到突破标准',
  GEX_WORSENING: '多期限 GEX balance 仍向不利方向恶化', WALL_BREACHED: '对应墙位已被穿越',
  COUNTER_TREND_BLOCKED: '逆趋势方向已阻断', STRUCTURE_TARGET_BELOW_1_5R: '最近结构目标不足 1.5R',
  STRUCTURE_TARGET_BELOW_1_25R: '最近结构目标不足 1.25R', STRUCTURE_TARGET_BELOW_1R: '最近结构目标不足 1R',
  DUPLICATE_SIGNAL: '同方向同结构 8 根 K 线内已提醒', REARM_NOT_READY: '同结构尚未完成独立重新武装',
  ENTRY_SIGNAL_BUDGET_REACHED: '今日入场机会已达到 3 次上限', RISK_CUE_BUDGET_REACHED: '今日结构止损提示已达到 3 次上限',
  CANDIDATE_WINDOW_NOT_OPEN: 'C 级候选需等待 10:30 ET', NO_DIRECTIONAL_BIAS: '趋势与价格位置尚无一致方向',
  C_SETUP_READY: '方向背景成立，等待价格靠近区域', C_ARMED: '价格已靠近区域，等待收回确认',
  C_TRIGGER_NOT_CONFIRMED: '尚未完成收回确认', RISK_ELEVATED: '对应卖方方向风险正在升高',
  STOP_RISK_CONFIRMED: '墙位或量价结构已确认止损风险', NO_RISK_STRUCTURE: '下午暂无明确结构止损风险',
  GRADE_A_SETUP_READY: 'A级：完整确认链成立', GRADE_B_SETUP_READY: 'B级：核心结构成立，确认度略低',
  GRADE_C_CONTEXT_READY: 'C级：方向背景成立，必须人工确认', LONG_SETUP_READY: 'QQQ 多头结构成立',
  SHORT_SETUP_READY: 'QQQ 空头结构成立', AFTERNOON_RISK_CUE: '下午只作人工风险提示，不推断持仓',
};

const price = (value: number | null | undefined) => value == null ? '—' : value.toFixed(2);
const etTime = (value: string | null | undefined) => value ? new Date(value).toLocaleTimeString('zh-CN', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
const playbookLabel = (value: string | null | undefined) => value === 'TREND_PULLBACK' ? '顺势回踩' : value === 'RANGE_REVERSAL' ? '区间反转' : value === 'DIRECTIONAL_WATCH' ? '方向观察' : '仅观察';
const sellerSide = (signal: Pick<DisplaySignal, 'intent' | 'direction' | 'riskPlan'>) => signal.intent === 'RISK_CUE'
  ? signal.riskPlan?.atRisk ?? (signal.direction === 'LONG' ? 'SC' : signal.direction === 'SHORT' ? 'SP' : '—')
  : signal.direction === 'LONG' ? 'SP' : signal.direction === 'SHORT' ? 'SC' : '—';
const actionLabel = (signal: DisplaySignal | null) => {
  if (!signal) return '等待数据';
  const side = sellerSide(signal);
  if (signal.stage === 'SETUP') return `${side} 候选形成`;
  if (signal.stage === 'ARMED') return `${side} 靠近区域 · 等确认`;
  if (signal.stage === 'TRIGGERED') return `${side} 方向机会已确认`;
  if (signal.stage === 'RISK_ELEVATED') return `${side} 风险升高 · 先观察`;
  if (signal.stage === 'STOP_RISK') return `${side} 结构止损提示`;
  if ('status' in signal && signal.status === 'INSUFFICIENT_DATA') return '数据不足 · 不行动';
  return '暂无信号 · 继续观察';
};
const outcomeLabel = (signal: QqqIntradayDirectionalReplaySignal) => signal.outcome === 'RISK_CUE'
  ? signal.riskEvaluation?.classification === 'CONFIRMED_RISK' ? '后续风险延续'
    : signal.riskEvaluation?.classification === 'FALSE_STOP' ? '快速收回'
      : signal.riskEvaluation?.classification === 'PENDING' ? '待满 30 分钟' : '后续中性'
  : signal.outcome === 'PENDING' ? '等待下一根' : signal.outcome === 'NOT_FILLED' ? '未模拟成交'
    : signal.outcome === 'ZONE_REACHED' ? `进入计划区${signal.opportunityEvaluation?.minutesToZone ? ` · ${signal.opportunityEvaluation.minutesToZone}m` : ''}`
      : signal.outcome === 'ZONE_NOT_REACHED' ? '30分钟未进区'
    : signal.outcome === 'TARGET_1R' ? '到达 1R' : signal.outcome === 'INVALIDATION' ? '结构失效' : '30 分钟到时';
const stageIndex = (stage: DisplaySignal['stage']) => stage === 'SETUP' ? 1 : stage === 'ARMED' ? 2 : stage === 'TRIGGERED' ? 3 : stage === 'RISK_ELEVATED' ? 1 : stage === 'STOP_RISK' ? 2 : 0;

function playAlertTone() {
  const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.setValueAtTime(720, context.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(980, context.currentTime + 0.18);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.3);
  oscillator.addEventListener('ended', () => void context.close());
}

type SignalLogFilter = 'ALL' | 'ENTRY' | 'RISK_CUE' | 'CONFIRMED';

const signalFilterLabel: Record<SignalLogFilter, string> = {
  ALL: '全部', ENTRY: '机会', RISK_CUE: '风险', CONFIRMED: '已确认',
};

export function QqqDirectionalSignalConsole({ sectionMode='all', directional, replay, historicalDate, replayLoading = false, researchReplay, researchLoading = false, onResearchOpen, visible = true }: { sectionMode?:'all'|'monitor'|'research'; historicalDate?: string | null; replayLoading?: boolean; visible?: boolean; flat?: boolean; directional?: Directional | null; replay?: QqqDirectionalReplayApiResponse | null; researchReplay?: QqqDirectionalReplayApiResponse | null; researchLoading?: boolean; onResearchOpen?: () => void }) {
  const isHistorical = Boolean(replay || historicalDate);
  const panelId = useId();
  const [focusedAnchor, setFocusedAnchor] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => { if(sectionMode==='research')return;setActivePanel('log'); setLogFilter('ALL'); setFocusedAnchor((event as CustomEvent<string>).detail); };
    window.addEventListener('qqq-gex:open-reminder', open); return()=>window.removeEventListener('qqq-gex:open-reminder',open);
  }, [sectionMode]);
  useEffect(()=>{if(focusedAnchor) document.getElementById(`${panelId}-reminder-${focusedAnchor}`)?.scrollIntoView({block:'nearest'});},[focusedAnchor,panelId]);
  const [activePanel, setActivePanel] = useState(sectionMode==='research'?'research':'current');
  const [, setClock] = useState(0);
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [logFilter, setLogFilter] = useState<SignalLogFilter>('ALL');
  const notificationReady = useRef(false);
  const current = directional?.current ?? null;
  const replayDisplayed = replay?.items.at(-1) ?? null;
  const displayed: DisplaySignal | null = replayDisplayed ?? current;
  const outcomes = useMemo(() => replay?.items ?? directional?.outcomes ?? [], [directional?.outcomes, replay?.items]);
  const signals = useMemo(() => replay?.items ?? directional?.signals ?? [], [directional?.signals, replay?.items]);
  const research = researchReplay ?? replay;

  useEffect(() => {
    if (visible && activePanel === 'research') onResearchOpen?.();
  }, [activePanel, onResearchOpen,visible]);

  useEffect(() => {
    setAlertsEnabled(window.localStorage.getItem(ALERTS_KEY) === '1');
    notificationReady.current = true;
  }, []);
  useEffect(() => {
    if (!visible || isHistorical || activePanel !== 'current' || (!current?.validUntil && !current?.dataQuality.evaluatedAt)) return;
    let timer: number | undefined;
    const update = () => { if (document.visibilityState === 'visible') setClock(value => value + 1); };
    const syncVisibility = () => {
      window.clearInterval(timer);
      if (document.visibilityState === 'visible') { update(); timer = window.setInterval(update, 1_000); }
    };
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', syncVisibility); };
  }, [visible, activePanel, isHistorical, replay, current?.validUntil,current?.dataQuality.evaluatedAt]);
  useEffect(() => {
    if (sectionMode==='research' || isHistorical || !qqqMarketSession(new Date()).stocksOpen || directional?.liveStatus?.available === false || !notificationReady.current || !alertsEnabled || !current?.signalId || !current.validUntil || Date.parse(current.validUntil) <= Date.now() || !['ALERT_LONG', 'ALERT_SHORT'].includes(current.status)) return;
    if (!directionalSignalPresentation(current,Date.now()).actionable) return;
    if (!directional?.signals.some(signal => signal.signalId === current.signalId)) return;
    if (window.localStorage.getItem(LAST_SIGNAL_KEY) === current.signalId) return;
    window.localStorage.setItem(LAST_SIGNAL_KEY, current.signalId);
    playAlertTone();
    if ('Notification' in window && Notification.permission === 'granted') {
      const zone = current.riskPlan?.triggerZone ?? current.entryZone;
      new Notification(`QQQ · ${actionLabel(current)}`, { body: zone ? `${price(zone.low)}–${price(zone.high)} · ${playbookLabel(current.playbook)}` : playbookLabel(current.playbook) });
    }
  }, [alertsEnabled, current, directional?.signals, directional?.liveStatus?.available, isHistorical,sectionMode]);

  const toggleAlerts = async () => {
    const enabled = !alertsEnabled;
    setAlertsEnabled(enabled);
    window.localStorage.setItem(ALERTS_KEY, enabled ? '1' : '0');
    if (enabled) {
      playAlertTone();
      if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    }
  };

  const remaining = current?.validUntil ? Math.max(0, Math.floor((Date.parse(current.validUntil) - Date.now()) / 1_000)) : null;
  const [todayEntries, todayConfirmed, todayStops] = useMemo(() => {
    const entries = new Set<string | null>(); let confirmed = 0, stops = 0;
    for (const signal of signals) {
      if (signal.intent === 'ENTRY') { entries.add(signal.structureId); if (signal.stage === 'TRIGGERED') confirmed++; }
      if (signal.intent === 'RISK_CUE') stops++;
    }
    return [entries.size, confirmed, stops];
  }, [signals]);
  const view = directionalSignalPresentation(displayed, Date.now(), isHistorical);
  const tone = `var(--${view.tone === 'danger' ? 'accent-danger' : view.tone === 'warning' ? 'accent-warning' : view.tone === 'accent' ? 'accent-primary' : 'text-secondary'})`;
  const zone = displayed?.riskPlan?.triggerZone ?? displayed?.entryZone ?? null;
  const recovery = displayed?.riskPlan?.recoveryLevel ?? null;
  const progress = stageIndex(displayed?.stage ?? null);
  const quality = current?.dataQuality;
  const qualityElapsed = quality?.evaluatedAt ? Math.max(0,(Date.now()-Date.parse(quality.evaluatedAt))/1000) : 0;
  const reasons = current?.reasonCodes ?? [];
  const outcomeById = useMemo(() => new Map(outcomes.map((item) => [item.signalId, item])), [outcomes]);
  const filteredSignals = useMemo(() => signals.slice().reverse().filter((signal) => {
    if (logFilter === 'ENTRY') return signal.intent === 'ENTRY';
    if (logFilter === 'RISK_CUE') return signal.intent === 'RISK_CUE';
    if (logFilter === 'CONFIRMED') return signal.stage === 'TRIGGERED' || signal.stage === 'STOP_RISK';
    return true;
  }), [logFilter, signals]);
  const displayStatus = isHistorical && !replay ? replayLoading ? '正在读取历史提醒' : '历史提醒暂不可用' : replay ? `历史回放 · ${view.title}` : view.title;
  const isResearch = Boolean(research);

  return <section aria-label="QQQ 方向信号台" className={`${styles.console} qqq-dir-console`}>
    <div className="qqq-dir-head">
      <div className="qqq-dir-kicker"><strong>{sectionMode==='research'?'提醒验证':'盘中提示'}</strong><span title="当前信号属于实验研究，尚未完成独立验证。">研究阶段</span></div>
      {!isHistorical && sectionMode!=='research' && <button type="button" className="qqq-dir-alert" onClick={toggleAlerts} aria-label={alertsEnabled ? '关闭声音提醒' : '开启声音提醒'} aria-pressed={alertsEnabled}>{alertsEnabled ? <Bell size={13} /> : <BellOff size={13} />}声音{alertsEnabled ? '已开' : '已关'}</button>}
    </div>
    {sectionMode!=='research' && <div role="tablist" aria-label="盘中提示内容" className="qqq-dir-tabs">{(sectionMode==='monitor'?[['current', '当前提示'], ['log', `提醒记录${signals.length ? ` ${signals.length}` : ''}`]]:[['current', '当前提示'], ['log', `提醒记录${signals.length ? ` ${signals.length}` : ''}`], ['research', '研究统计']]).map(([id, label]) => <button key={id} type="button" role="tab" id={`${panelId}-tab-${id}`} aria-controls={`${panelId}-${id}`} aria-selected={activePanel === id} tabIndex={activePanel === id ? 0 : -1} onKeyDown={(event) => {
        const ids = sectionMode==='monitor'?['current','log']:['current', 'log', 'research'];
        const index = ids.indexOf(id);
        const nextIndex = event.key === 'ArrowRight' ? (index + 1) % ids.length : event.key === 'ArrowLeft' ? (index + ids.length - 1) % ids.length : event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : null;
        if (nextIndex === null) return;
        event.preventDefault();
        setActivePanel(ids[nextIndex]);
        const nextTab = event.currentTarget.parentElement?.children[nextIndex];
        if (nextTab instanceof HTMLButtonElement) nextTab.focus();
      }} onClick={() => setActivePanel(id)}>{label}</button>)}</div>}
    <div role="tabpanel" id={`${panelId}-current`} aria-labelledby={`${panelId}-tab-current`} hidden={activePanel !== 'current'}>
      {!isHistorical && directional?.liveStatus?.available === false && <p className="qqq-dir-empty" role="status">实时提醒暂不可用：{directional.liveStatus.reason}</p>}
      <h3 className="qqq-dir-action" style={{ color: tone }} aria-live="polite">{displayStatus}</h3>
      <div className="qqq-dir-action-strip"><span>下一步</span><p>{isHistorical ? '这是历史记录，不代表当前行动。' : view.next}</p></div>
      {view.actionable && <>
        <ol className="qqq-dir-progress" aria-label="提示进度">{view.steps.map((step, index) => <li key={step} data-complete={index < progress} aria-current={index === progress - 1 ? 'step' : undefined}><span>{index + 1}</span>{step}</li>)}</ol>
        <div className="qqq-dir-grid">
          {zone && <div className="qqq-dir-metric"><span>{displayed?.intent === 'RISK_CUE' ? '风险价格区域' : '观察价格区域'}</span><strong>{price(zone.low)}–{price(zone.high)}</strong></div>}
          {(displayed?.intent === 'RISK_CUE' ? recovery != null : displayed?.invalidation != null) && <div className="qqq-dir-metric"><span>{displayed?.intent === 'RISK_CUE' ? '风险缓解观察价' : '计划失效价格'}</span><strong>{price(displayed?.intent === 'RISK_CUE' ? recovery : displayed?.invalidation)}</strong></div>}
          {displayed?.intent === 'ENTRY' && displayed.targets && <><div className="qqq-dir-metric"><span title="价格向有利方向移动一个初始风险距离。">第一观察目标</span><strong>{price(displayed.targets.oneR)}</strong></div><div className="qqq-dir-metric"><span>结构目标价格</span><strong>{price(displayed.targets.structure)}</strong></div></>}
        </div>
        {displayed?.validUntil && <p className="qqq-dir-deadline">{isHistorical ? '当时有效至' : '提示有效至'} {new Date(displayed.validUntil).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })}（北京时间）{!isHistorical && remaining !== null && remaining > 0 ? ` · 剩余 ${Math.floor(remaining / 60)}分${remaining % 60}秒` : ''}</p>}
      </>}
      {!view.actionable && <p className="qqq-dir-empty">{reasons.includes('NO_RISK_STRUCTURE') ? '目前没有明确的持仓风险提示。' : '有新的有效提示时，这里会自动更新。'}</p>}
      {!!reasons.length && !reasons.includes('NO_RISK_STRUCTURE') && <p className="qqq-dir-reasons">{reasons.map(reason => reasonLabels[reason] ?? reason).join('；')}</p>}
      <div className="qqq-dir-meta"><span>{quality?.barAgeSeconds != null ? `判断所用 K 线：${Math.round(quality.barAgeSeconds+qualityElapsed)} 秒前` : '判断所用 K 线时间待确认'}</span><span>{quality?.gexAgeSeconds != null ? `判断所用 GEX：${Math.round(quality.gexAgeSeconds+qualityElapsed)} 秒前` : '判断所用 GEX 时间待确认'}</span>{quality?.quoteCoverage.ratio != null && <span title="所选到期日期权中具有可用报价的比例。">可用报价 {Math.round(quality.quoteCoverage.ratio * 100)}%</span>}</div>
    </div>
    <div role="tabpanel" id={`${panelId}-log`} aria-labelledby={`${panelId}-tab-log`} hidden={activePanel !== 'log'} className="qqq-dir-details">
      <p className="qqq-dir-empty">{isHistorical ? '历史回放：按当时数据重建，不能证明这些提示曾实时发出。' : directional?.liveStatus?.available === false ? directional.liveStatus.reason : '这里仅显示盘中实际保存的提醒，历史回放另行展示。'}</p>
      <p className="qqq-dir-summary-count">{isHistorical && !replay ? '所选日期 · 提醒数据尚未载入' : <>{isHistorical ? '所选日期' : '今日'} · 机会 {todayEntries} · 已确认 {todayConfirmed} · 风险提醒 {todayStops}（记录时间为美东时间）</>}</p>
      <div className="qqq-dir-log" style={{ marginTop: 8 }}>
        <div aria-label="信号日志筛选" className="qqq-dir-filter-bar" role="group">
          {(Object.keys(signalFilterLabel) as SignalLogFilter[]).map((filter) => <button key={filter} type="button" className="qqq-dir-filter" aria-pressed={logFilter === filter} onClick={() => setLogFilter(filter)}>{signalFilterLabel[filter]}</button>)}
        </div>
        <div className="qqq-dir-log-list">
          {filteredSignals.length ? filteredSignals.map((signal) => {
            const outcome = signal.signalId ? outcomeById.get(signal.signalId) : undefined;
            const signalZone = signal.riskPlan?.triggerZone ?? signal.entryZone;
            const signalColor = signal.intent === 'RISK_CUE' ? 'var(--accent-warning)' : signal.direction === 'LONG' ? 'var(--accent-success)' : 'var(--accent-primary)';
            return <div key={signal.signalId} id={`${panelId}-reminder-${signal.anchorBar}`} role="button" tabIndex={0} aria-label={`定位 ${etTime(signal.anchorBar)} 的提醒到图表`} onClick={()=>{setFocusedAnchor(signal.anchorBar);window.dispatchEvent(new CustomEvent('qqq-gex:focus-signal',{detail:signal.anchorBar}));}} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setFocusedAnchor(signal.anchorBar);window.dispatchEvent(new CustomEvent('qqq-gex:focus-signal',{detail:signal.anchorBar}));}}} className="qqq-dir-log-row" style={{ cursor:'pointer', background:focusedAnchor===signal.anchorBar?'var(--bg-hover)':undefined, borderLeft: `2px solid ${signalColor}`, paddingLeft: 6 }}>
              <span>{etTime(signal.anchorBar)}</span><strong className="qqq-dir-log-side" style={{ color: signalColor }}>{sellerSide(signal) === 'SP' ? '卖出看跌' : sellerSide(signal) === 'SC' ? '卖出看涨' : '风险观察'} · {signal.grade ?? '风险'}</strong>
              <span className="qqq-dir-log-zone">{signalZone ? `${price(signalZone.low)}–${price(signalZone.high)}` : '—'} · {playbookLabel(signal.playbook)}</span><span className="qqq-dir-log-outcome">{outcome ? outcomeLabel(outcome) : signal.stage}</span>
            </div>;
          }) : <div className="qqq-dir-empty">{isHistorical && !replay ? replayLoading ? '正在读取该日期的提醒记录…' : '该日期提醒数据暂不可用，可单独重试；图表仍可查看。' : signals.length ? '当前筛选没有记录。' : '本日尚未形成可用机会；普通观察不会写库。'}</div>}
        </div>
      </div>
    </div>
    {sectionMode!=='monitor' && <div role="tabpanel" id={`${panelId}-research`} aria-label={sectionMode==='research'?'提醒验证':undefined} aria-labelledby={sectionMode==='research'?undefined:`${panelId}-tab-research`} hidden={activePanel !== 'research'} className="qqq-dir-details">
      {!isResearch && <p className="qqq-dir-empty">{researchLoading ? '正在读取统计…' : '暂无统计，记录提示后会在这里展示结果。'}</p>}
      {research && <QqqDirectionalResearchOverview research={research} />}
      {research && <details className="qqq-dir-research-details"><summary>查看详细指标与统计口径</summary>
      <p className="qqq-dir-explanation">R 表示一次计划的风险距离；MFE 是观察期间最大有利波动，MAE 是最大不利波动。ATR 表示近期价格的正常波动幅度。下列比例都应结合样本数量阅读。</p>
      <div className="qqq-dir-research-grid">
        {research?.funnel && <div className="qqq-dir-insight"><h4>提示筛选过程</h4><p>数据可用 <strong>{research.funnel.dataReadyWindowBars}/{research.funnel.alertWindowBars}</strong> 根 · 候选 <strong>{research.funnel.entry.setups}</strong> → 靠近观察区 <strong>{research.funnel.entry.armed}</strong> → 独立机会 <strong>{research.funnel.entry.emitted}</strong> → 确认 <strong>{research.funnel.entry.confirmed}</strong></p><p>下午风险升高 {research.funnel.risk.elevated} → 止损候选 {research.funnel.risk.stopCandidates} → 独立提醒 {research.funnel.risk.emitted}</p></div>}
        {research?.opportunityStats && <div className="qqq-dir-insight"><h4>进入观察区后的走势</h4><p>先到 +0.5R <strong>{research.opportunityStats.halfRSuccessRate == null ? '—' : `${(research.opportunityStats.halfRSuccessRate * 100).toFixed(0)}%`}</strong> · 先失效 {research.opportunityStats.invalidatedBeforeHalfRRate == null ? '—' : `${(research.opportunityStats.invalidatedBeforeHalfRRate * 100).toFixed(0)}%`}</p><p>MFE {research.opportunityStats.averageMfeR?.toFixed(2) ?? '—'}R · MAE {research.opportunityStats.averageMaeR?.toFixed(2) ?? '—'}R</p></div>}
        {research?.lifecycleStats && <div className="qqq-dir-insight"><h4>机会确认进展</h4><p>独立机会 <strong>{research.lifecycleStats.opportunityStructures}</strong> · 确认 {research.lifecycleStats.confirmedSignals} · 升级 {research.lifecycleStats.confirmedUpgrades} · 直接确认 {research.lifecycleStats.directConfirmed}</p><p>升级率 <strong>{research.lifecycleStats.confirmedUpgradeRate == null ? '—' : `${(research.lifecycleStats.confirmedUpgradeRate * 100).toFixed(0)}%`}</strong> · 重复提示被拦截 {research.funnel.entry.rearmBlocked + research.funnel.risk.rearmBlocked}</p></div>}
        {research?.riskStats && <div className="qqq-dir-insight"><h4>下午止损提示</h4><p>升高 {research.riskStats.elevated} · 候选 {research.riskStats.stopCandidates} · 已发 {research.riskStats.emitted}</p><p>后续确认 <strong>{research.riskStats.confirmedRiskRate == null ? '—' : `${(research.riskStats.confirmedRiskRate * 100).toFixed(0)}%`}</strong> · 小幅波动后恢复 {research.riskStats.falseStopRate == null ? '—' : `${(research.riskStats.falseStopRate * 100).toFixed(0)}%`} · 不利 {research.riskStats.averageAdverseMove30mAtr == null ? '—' : `${research.riskStats.averageAdverseMove30mAtr.toFixed(2)} ATR`}</p></div>}
        {research?.validation.progress && <div className="qqq-dir-insight"><h4>验证所需样本的积累进度</h4><p>完整日 <strong>{research.validation.progress.completeDays}/{research.validation.progress.requiredCompleteDays}</strong> · 确认成交 {research.validation.progress.filledSignals}/{research.validation.progress.requiredFilledSignals}</p><p>LONG {research.validation.progress.longSignals}/{research.validation.progress.requiredLongSignals} · SHORT {research.validation.progress.shortSignals}/{research.validation.progress.requiredShortSignals}</p></div>}
        {research?.gradeStats && <div className="qqq-dir-insight"><h4>分级胜率</h4>{(['A', 'B', 'C'] as const).map((grade) => { const stat = research.gradeStats[grade]; return <div key={grade} className="qqq-dir-stat-row"><span>{grade}级 · {stat.signalDays}日 / {stat.filled}成交</span><strong>{stat.winRate == null ? '胜率 —' : `${(stat.winRate * 100).toFixed(0)}% · ${stat.averageNetR?.toFixed(2) ?? '—'}R`}</strong></div>; })}</div>}
        {research?.dailyStats && <div className="qqq-dir-insight qqq-dir-research-wide"><h4>逐日覆盖（只看完整日）</h4><div className="qqq-dir-day-list">{research.dailyStats.filter((day) => day.complete).map((day) => <span key={day.date}>{day.date.slice(5)}：{day.opportunitySignals}机会/{day.confirmedSignals}确认 · {day.alertWindowBars ? Math.round(day.dataReadyWindowBars / day.alertWindowBars * 100) : 0}%</span>)}</div></div>}
        {research?.groupedStats && <div className="qqq-dir-insight qqq-dir-research-wide"><h4>按方向 / 时段 / 级别统计</h4>{Object.entries(research.groupedStats.confirmed).flatMap(([dimension, groups]) => Object.entries(groups).map(([key, stat]) => <div key={`confirmed-${dimension}-${key}`} className="qqq-dir-stat-row"><span>确认 · {dimension} · {key} · n={stat.evaluated}</span><strong style={{ color: stat.averageNetR != null && stat.averageNetR >= 0 ? 'var(--accent-success)' : 'var(--accent-danger)' }}>{stat.successRate == null ? '胜率 —' : `${(stat.successRate * 100).toFixed(0)}% · ${stat.averageNetR?.toFixed(2) ?? '—'}R`}</strong></div>))}{Object.entries(research.groupedStats.opportunity).flatMap(([dimension, groups]) => Object.entries(groups).map(([key, stat]) => <div key={`opportunity-${dimension}-${key}`} className="qqq-dir-stat-row"><span>机会 · {dimension} · {key} · n={stat.evaluated}</span><strong style={{ color: 'var(--accent-warning)' }}>{stat.successRate == null ? '样本 —' : `先到0.5R ${(stat.successRate * 100).toFixed(0)}%`}</strong></div>))}</div>}
      </div>
      <div className="qqq-dir-footnote">统计版本 v5 · 美东 10:00–13:00 最多提醒 3 个独立方向机会；13:00–16:00 只提醒结构风险。模拟成交仅评估 A/B 级已确认提示，每边成本 0.01%，最多观察 30 分钟。历史结果仅作研究。{research?.fingerprint ? ` · 数据标识 ${research.fingerprint.slice(0, 10)}…` : ''}</div>
      </details>}
    </div>}
    {researchLoading && activePanel === 'research' && <div aria-busy="true" aria-label="方向研究摘要加载中" className="qqq-dir-details"><div className="qqq-dir-research" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', borderRadius: 7, padding: 8 }}>研究质量与胜率加载中…</div></div>}
  </section>;
}
