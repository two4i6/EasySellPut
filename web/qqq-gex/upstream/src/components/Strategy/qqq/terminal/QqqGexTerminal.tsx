'use client';

import QqqInfoTooltip from '../QqqInfoTooltip';
import { QqqObservationPage, QqqObservationEmpty } from './QqqObservationUi';
import { QQQ_GEX_LABELS } from '@/lib/qqqGexLabels';
import type { CSSProperties, ReactNode } from 'react';
import { QqqTerminalWorkspace, QqqTerminalTabs, QqqTerminalPortalHost } from '../QqqTerminalWorkspace';
import { QQQ_GEX_LEFT_TAB_LABELS, QQQ_GEX_RIGHT_TAB_LABELS } from './qqqTerminalTabsModel';
import { QqqOptionActivityObservation } from './QqqOptionActivityObservation';
import type { PcsGexExpiry } from '@/types/qqqGex';

type Tone = 'neutral' | 'positive' | 'warning' | 'danger' | 'accent';
type Source = 'REAL' | 'DERIVED' | 'INFERRED' | 'PROXY' | 'UNAVAILABLE';

export type QqqGexTerminalViewModel = {
  asOf: string | null;
  dataStatus: 'LIVE' | 'STALE' | 'INSUFFICIENT';
  decision: { regime: string; primaryRisk: string; premiumEdge: string; keyLevel: string; action: string; confidence: number | null; dataQuality: string; reasons: string[]; transition: string[]; playbook: string[] } | null;
  structure: { gammaState?:string; netGex: string; spotVsFlip: string; dealerBias: string; dealerIntensity: string; dealerConfidence: number | null } | null;
  volatility: { currentIv: string; hv20: string; vrp: string; ivRank: string; environment: string; confidence: number | null } | null;
  expectedMove: { range: string; position: string; lowerRoom: string; upperRoom: string; status: string; implication: string; source: Source } | null;
  walls: Array<{ kind: 'CALL' | 'PUT'; strike: string; quality: string; confidence: string; distance: string; classification: string; strengths: string[]; weaknesses: string[] }>;
  eligibility: { status: 'ELIGIBLE' | 'CONDITIONAL' | 'BLOCKED' | 'UNAVAILABLE'; blockingReasons: string[]; requiredConditions: string[]; confidence: number | null };
  history: { snapshotCount: number; summary: string } | null;
  optionActivityExpiry?: PcsGexExpiry | null;
  optionActivityLabel?: string;
  structureScopeLabel?: string;
};

const colors: Record<Tone, string> = { neutral: 'var(--text-primary)', positive: 'var(--accent-success)', warning: 'var(--accent-warning)', danger: 'var(--accent-danger)', accent: '#a5b4fc' };
const label: CSSProperties = { color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.04em' };
const confidenceLabel = (value: number | null) => value === null ? '—' : value >= 75 ? '高' : value >= 50 ? '中等' : value >= 25 ? '低' : '很低';
const plainRegime = (value: string | undefined) => value === 'POSITIVE_GAMMA' ? '正 Gamma' : value === 'NEGATIVE_GAMMA' ? '负 Gamma' : value === 'TRANSITION' ? '过渡状态' : value ?? '暂无';
const plainAction = (value: string | undefined) => value === 'ELIGIBLE' ? '复核候选合约' : value === 'CONDITIONAL' ? '等条件确认' : value === 'UNAVAILABLE' ? '待复核' : value === 'BLOCKED' ? '暂不开仓' : value === 'WAIT' ? '先等等' : value ?? '暂不开仓';
const plainKeyLevel = (value: string | undefined) => (value ?? '—').replace('CALL_WALL', '上方墙').replace('PUT_WALL', '下方墙').replace('GAMMA_FLIP', QQQ_GEX_LABELS.distributionFlip);

function SourceBadge({ source }: { source: Source }) {
  if (source === 'REAL') return null;
  const text = source === 'DERIVED' ? '计算值' : source === 'INFERRED' ? '推算值' : source === 'PROXY' ? '替代值' : '暂无';
  return <span style={{ border: '1px solid var(--border-subtle)', borderRadius: 4, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: '0.5rem', marginLeft: 5, padding: '1px 3px' }}>{text}</span>;
}

function Metric({ label: title, value, detail, tone = 'neutral', source }: { label: string; value: string; detail?: string; tone?: Tone; source?: Source }) {
  return <div><div style={label}>{title}{detail ? <QqqInfoTooltip label={`${title}说明`} content={detail}/> : null}{source ? <SourceBadge source={source} /> : null}</div><strong style={{ color: colors[tone], display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.74rem', marginTop: 1 }}>{value}</strong></div>;
}

/** Read-only decision terminal. It presents a single evidence chain and never opens or selects a trade. */
export function QqqGexTerminal({ indicatorObservationRef, activityResponseRef, activityHistoryRef, intradayPulseContent, spreadStudyContent, wallStatsContent, maxPainContent, atmIvContent, distributionRef, onDataTabChange,referenceTerminal,referenceLabel,observationLabel,terminal, chart, topContent, topRightContent, chartLegendRef, structureObservationRef, snapshotTableRef, conditionsLoading = false, conditionsError, onConditionsRetry, onConditionsOpen, onConditionsClose, onActiveTabChange, sideContent, leftContent, dateContent, statusContent, requestFeedback, chartLoading = false, chartLoadingLabel = '正在加载图表数据' }: { indicatorObservationRef?:(element:HTMLDivElement|null)=>void; activityResponseRef?:(element:HTMLDivElement|null)=>void; activityHistoryRef?:(element:HTMLDivElement|null)=>void; intradayPulseContent?:ReactNode; spreadStudyContent?:ReactNode; wallStatsContent?:ReactNode; maxPainContent?:ReactNode; atmIvContent?:ReactNode; distributionRef?:(element:HTMLDivElement|null)=>void; onDataTabChange?:(label:string)=>void;referenceTerminal?:QqqGexTerminalViewModel;referenceLabel?:string;observationLabel?:string;conditionsError?: string | null; onConditionsRetry?:()=>void; conditionsLoading?:boolean; onConditionsOpen?:()=>void; onConditionsClose?:()=>void; onActiveTabChange?:(label:string)=>void; terminal: QqqGexTerminalViewModel; chart: ReactNode; topContent?: ReactNode; topRightContent?: ReactNode; chartLegendRef?: (node: HTMLDivElement | null) => void; structureObservationRef?: (node: HTMLDivElement | null) => void; snapshotTableRef?: (node: HTMLDivElement | null) => void; sideContent?: ReactNode; leftContent?: ReactNode; dateContent?: ReactNode; statusContent?: ReactNode; requestFeedback?: ReactNode; chartLoading?: boolean; chartLoadingLabel?: string }) {
  const conditions=referenceTerminal??terminal;
  const volatility=terminal.volatility??(!observationLabel?.startsWith('回放')?conditions.volatility:null);
  const leftTabs = [
    { label: QQQ_GEX_LEFT_TAB_LABELS.gamma, content: leftContent ?? <QqqObservationEmpty>等待期权持仓与 IV 更新。</QqqObservationEmpty> },
    { label: QQQ_GEX_LEFT_TAB_LABELS.activity, content: <QqqOptionActivityObservation expiry={terminal.optionActivityExpiry ?? null} scopeLabel={terminal.optionActivityLabel} /> },
    { label: '结构观察', content: <div className="qqq-terminal-evidence">
      <h3>GEX 与市场结构{terminal.structureScopeLabel ? ` · ${terminal.structureScopeLabel}` : ''}</h3>
      <div className="qqq-terminal-metrics">
        <Metric label="净 GEX" value={terminal.structure?.netGex ?? '—'} />
        <Metric label="快照 GEX 正负" value={terminal.structure?.gammaState??'—'} />
        <Metric label={QQQ_GEX_LABELS.assumptionBias} value={terminal.structure?.dealerBias ?? '—'} />
        <Metric label="现价与 GEX 分布换号价" value={terminal.structure?.spotVsFlip ?? '—'} />
        <Metric label={QQQ_GEX_LABELS.assumptionIntensity} value={terminal.structure?.dealerIntensity ?? '—'} detail={`置信度 ${confidenceLabel(terminal.structure?.dealerConfidence ?? null)}`} />
        {terminal.walls.map(wall => <Metric key={wall.kind} label={wall.kind === 'CALL' ? '看涨墙' : '看跌墙'} value={wall.strike} detail={`距离 ${wall.distance} · ${wall.classification}`} />)}
      </div>
      {terminal.expectedMove && <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 12, paddingTop: 10 }}>
        <h3>预期波动区间 <QqqInfoTooltip label="预期波动区间说明" content={terminal.expectedMove.implication}/></h3>
        <div className="qqq-terminal-metrics"><Metric label="区间" value={terminal.expectedMove.range} source={terminal.expectedMove.source} /><Metric label="当前位置" value={terminal.expectedMove.position} detail={terminal.expectedMove.status} /><Metric label="下方空间" value={terminal.expectedMove.lowerRoom} /><Metric label="上方空间" value={terminal.expectedMove.upperRoom} /></div>

      </div>}
      {volatility ? <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 12, paddingTop: 10 }}>
        <h3>波动率环境</h3>
        <p style={{fontSize:'.62rem',color:'var(--text-tertiary)'}}>波动率参考 · {referenceLabel}</p><div className="qqq-terminal-metrics">{[{label:'当前 IV',value:volatility.currentIv},{label:'HV20',value:volatility.hv20},{label:'VRP',value:volatility.vrp},{label:'IV Rank',value:volatility.ivRank}].filter(item=>item.value!=='—'&&!item.value.startsWith('积累中')).map(item=><Metric key={item.label} label={item.label} value={item.value}/>)}</div>{volatility.ivRank.startsWith('积累中')&&<p style={{fontSize:'.62rem'}}>IV Rank {volatility.ivRank}：需要更多有效样本。</p>}
        <p style={{ color: 'var(--text-secondary)', fontSize: '.68rem', margin: '8px 0 0' }}>{volatility.environment}</p>
      </div> : <p role="status" style={{fontSize:'.65rem',color:'var(--text-tertiary)'}}>当前快照未提供完整波动率；可在“条件”页加载。回放不混入最新计算。</p>}
    </div> },

  ];
  return <QqqTerminalWorkspace left={<QqqTerminalTabs onTabChange={onDataTabChange} lazy label="数据观察" storageKey="qqq-gex:left-tab:v1" items={[
    {label:QQQ_GEX_LEFT_TAB_LABELS.gamma,content:<QqqObservationPage description="查看持仓模型与价格附近的关键位置。">{leftTabs[0].content}<details style={{fontSize:'.68rem',borderTop:'1px solid var(--border-subtle)',marginTop:10,paddingTop:8}}><summary>结构与波动率详情</summary>{leftTabs[2].content}</details></QqqObservationPage>},
    {label:'行权价分布',content:<QqqObservationPage><QqqTerminalPortalHost onTarget={distributionRef} style={{minHeight:0}} /></QqqObservationPage>},
    {label:QQQ_GEX_LEFT_TAB_LABELS.activity,content:<QqqObservationPage description="比较 Call / Put 成交与持仓，查看成交集中价。">{leftTabs[1].content}{activityHistoryRef&&<QqqTerminalPortalHost onTarget={activityHistoryRef} style={{minHeight:0}}/>}</QqqObservationPage>},
    ...(indicatorObservationRef?[{label:QQQ_GEX_LEFT_TAB_LABELS.structure,content:<QqqObservationPage description="查看暴露变化与关键位事件；点击记录回放。"><QqqTerminalPortalHost onTarget={indicatorObservationRef} style={{minHeight:0}}/></QqqObservationPage>}]:[]),
    ...(activityResponseRef?[{label:QQQ_GEX_LEFT_TAB_LABELS.response,content:<QqqObservationPage description="查看成交活动、模型调整与同期价格反应。"><QqqTerminalPortalHost onTarget={activityResponseRef} style={{minHeight:0}}/></QqqObservationPage>}]:[]),
    ...(intradayPulseContent ? [{label:'日内节奏',content:<QqqObservationPage description="比较同窗波动、价格偏离与同期成交量。">{intradayPulseContent}</QqqObservationPage>}] : []),
    ...(spreadStudyContent ? [{label:'组合分析',content:<QqqObservationPage description="自选双腿，观察交易成本与价格／时间／IV 盈亏情景。">{spreadStudyContent}</QqqObservationPage>}] : []),
    ...(wallStatsContent ? [{label:'触位统计',content:<QqqObservationPage description="按 DTE、Gamma 与时段筛选历史首次触墙的完整结果。">{wallStatsContent}</QqqObservationPage>}] : []),
    ...(maxPainContent ? [{label:'Max Pain / Time',content:<QqqObservationPage description="比较各到期日最大痛点，查看所选到期日历史变化。">{maxPainContent}</QqqObservationPage>}] : []),
    ...(atmIvContent ? [{label:'ATM IV',content:<QqqObservationPage description="比较各到期日隐含波动率、波动率漂移与所选到期日变化。">{atmIvContent}</QqqObservationPage>}] : []),
  ]} />} header={topContent} headerRight={topRightContent} showFocusButton={false} footer={statusContent} bottom={snapshotTableRef ? <div ref={snapshotTableRef} style={{ display: "flex", flex: 1, minWidth: 0, minHeight: 0 }} /> : undefined} main={<>
    <style>{`.qqq-terminal-chart{display:flex;flex:1;min-height:0;min-width:0;position:relative;border:1px solid var(--border-subtle);border-radius:5px;overflow:hidden}.qqq-terminal-dates{flex:0 0 auto;max-height:100px;overflow:auto}.qqq-terminal-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.qqq-terminal-reasons{color:var(--text-secondary);font-size:.68rem;line-height:1.6;margin:12px 0 0;padding-left:18px}.qqq-terminal-evidence h3{font-size:.65rem;margin:0;color:var(--text-secondary)}`}</style>
    <section aria-label="QQQ 价格与 GEX 图表" aria-busy={chartLoading || undefined} className="qqq-terminal-chart">{chart}{requestFeedback}{!requestFeedback && chartLoading && <div role="status" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--bg-card)', zIndex: 5, fontSize: '.75rem' }}>{chartLoadingLabel}</div>}</section>
    {dateContent && <div className="qqq-terminal-dates">{dateContent}</div>}
  </>} aside={<QqqTerminalTabs lazy storageKey="qqq-gex:right-tab:v1" activateOnEvent="qqq-gex:open-reminder" onTabChange={tab=>{onActiveTabChange?.(tab);if(tab===QQQ_GEX_RIGHT_TAB_LABELS.conditions)onConditionsOpen?.();else onConditionsClose?.();}} label="设置与监控" items={[
    { label: QQQ_GEX_RIGHT_TAB_LABELS.monitor, content: <div className="qqq-terminal-evidence"><p style={{fontSize:'.65rem',color:'var(--text-tertiary)'}}>独立提醒 · {referenceLabel}</p>{sideContent}</div> },
    { label: QQQ_GEX_RIGHT_TAB_LABELS.conditions, content: conditionsError ? <div role="status">{conditionsError} <button type="button" onClick={onConditionsRetry}>重试条件</button></div> : conditionsLoading ? <p role="status">正在读取条件…</p> : <>
      <p style={{fontSize:'.65rem',color:'var(--text-tertiary)'}}>独立复核 · {referenceLabel}</p><div className="qqq-terminal-metrics">
        <Metric label="开仓条件" value={plainAction(conditions.eligibility.status)} tone={conditions.eligibility.status === 'ELIGIBLE' ? 'accent' : 'warning'} />
        <Metric label="市场背景" value={plainRegime(conditions.decision?.regime)} />
        <Metric label="关键位置" value={plainKeyLevel(conditions.decision?.keyLevel)} />
        <Metric label="模型置信" value={confidenceLabel(conditions.decision?.confidence ?? null)} detail="规则估计，不是预测胜率" />
      </div>
      {!!conditions.eligibility.blockingReasons.length && <ul className="qqq-terminal-reasons">{[...new Set(conditions.eligibility.blockingReasons.map(reason => reason.startsWith('展示快路径') ? '开仓资格与真实合约，请到开仓检查页复核。' : reason === '盘中时机：INSUFFICIENT_DATA' ? '盘中数据不足，等待更新。' : reason))].map(reason => <li key={reason}>{reason}</li>)}</ul>}
      <QqqTerminalPortalHost onTarget={structureObservationRef} />
      <a href="/analysis/qqq#entry-check" style={{fontSize:'.7rem'}}>完整开仓检查 →</a>
    </> },
    ...(chartLegendRef ? [{ label: QQQ_GEX_RIGHT_TAB_LABELS.chartSettings, content: <QqqTerminalPortalHost onTarget={chartLegendRef} /> }] : []),
  ]} />} />;
}
