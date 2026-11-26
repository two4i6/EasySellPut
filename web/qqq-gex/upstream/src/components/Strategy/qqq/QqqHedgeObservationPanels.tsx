'use client';
import { memo, useMemo } from 'react';
import { hedgeObservationWindow, type HedgeObservation } from '@/lib/qqqHedgeObservations';
import { formatQqqMatrixGex } from './qqqGexMatrixModel';
import styles from './QqqExposureWorkbench.module.css';
import QqqInfoTooltip from './QqqInfoTooltip';
import { QqqObservationHeading, QqqObservationEmpty } from './terminal/QqqObservationUi';

export type HedgePanelFlags = { activity: boolean; hedge: boolean; response: boolean };
export const hedgePanelDefaults: HedgePanelFlags = { activity: true, hedge: true, response: true };
const time = new Intl.DateTimeFormat('zh-CN', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const amount = (n: number | null | undefined) => n == null ? '—' : formatQqqMatrixGex(n);
const colors = { call: '#60a5fa', put: '#fb923c', price: '#c4a5ff', time: '#d4b16a', iv: '#2dd4bf' };

function QqqHedgeObservationPanels({ series, cutoff, minutes, flags, width, plotLeft, plotRight, x, loading, error, scopeLabel }: {
  series: readonly HedgeObservation[] | null; cutoff: number; minutes: number; flags: HedgePanelFlags;
  width: number; plotLeft: number; plotRight: number; x: (time: number) => number;
  loading: boolean; error: boolean; scopeLabel: string;
}) {
  const visible = useMemo(() => series?.filter(point => point.time <= cutoff) ?? [], [series, cutoff]);
  const responses = useMemo(() => flags.response ? series?.map(point => {
    const reading = hedgeObservationWindow(series, point.time, minutes);
    return {time: point.time, pricePct: reading.pricePct, intensity: reading.intensity, response: reading.response, alignment: reading.alignment};
  }) ?? [] : [], [series, minutes, flags.response]);
  const visibleResponses = responses.filter(point => point.time <= cutoff);
  const responseMax = Math.max(.05, ...visibleResponses.map(point => Math.abs(point.pricePct ?? 0)));
  let connected = false;
  const responsePath = visibleResponses.map(point => {
    if (point.pricePct === null) { connected = false; return ''; }
    const command = `${connected ? 'L' : 'M'}${x(point.time)},${28 - point.pricePct / responseMax * 18}`;
    connected = true; return command;
  }).join(' ').trim();
  const window = useMemo(() => hedgeObservationWindow(series ?? [], cutoff, minutes), [series, cutoff, minutes]);
  const activityMax = Math.max(1, ...visible.map(point => point.activity?.total ?? 0));
  const hedgeMax = Math.max(1, ...visible.map(point => Math.max(Math.abs(point.hedge?.total ?? 0),
    ...(point.hedge ? [Math.abs(point.hedge.price), Math.abs(point.hedge.time), Math.abs(point.hedge.iv)] : []))));
  const unavailable = error ? '观察计算失败' : loading ? '准备历史观察…' : '数据不足';
  const interval = window.elapsed === null ? `近 ${minutes} 分钟` : `近 ${window.elapsed.toFixed(1)} 分钟`;
  const explanations: Record<string,string> = {活动强度:'新增成交量 × |Delta| × 100 × 当时价格。描述规模，无买卖方向；缺少部分成交量或 IV 时标记部分估算，累计成交量回退留空。',模型再对冲:'固定前一快照 OI，按价格 → 时间 → IV 分解对冲调整。正为假设买入，负为假设卖出；Call 正 / Put 负持仓假设，非真实做市商资金流。',价格响应:'曲线与标记均使用所选观察窗口。活动按窗口及前期基线共同有效合约比较，达到每分钟中位数的 1.5 倍时标记放大；价格变化达到 0.05% 才比较模型方向。仅描述已发生的反应。'};
  const title = (name: string, value: string) => <QqqObservationHeading title={name} meta={interval} info={explanations[name]} value={value}/>;
  const axis = (max: number, signed: boolean) => <g aria-label={signed ? '模型再对冲 Y 轴（美元）' : '活动强度 Y 轴（美元）'}>
    {(signed ? [-1, 0, 1] : [0, .5, 1]).map(ratio => {
      const y = signed ? 55 - ratio * 28 : 84 - ratio * 57;
      return <g key={ratio}><line x1={plotLeft} x2={plotRight} y1={y} y2={y} stroke="#52586a" opacity=".35" strokeDasharray={ratio === 0 ? undefined : '3 4'} />
        <text x={plotRight + 8} y={y + 3} fill="#9ca3af" fontSize="9">{amount(max * ratio)}</text></g>;
    })}
  </g>;
  return <section className={styles.observationPanels} aria-label="期权活动与价格响应">
    {flags.activity && <article className={styles.observationCard}>
      {title('活动强度', window.activity ? `${amount(window.activity.total)}${window.activityPartial?'（部分）':''}` : '—')}
      {visible.some(point=>point.activity) ? <><div className={styles.observationMetrics}><span style={{ color: colors.call }}>Call {amount(window.activity?.call)}</span><span style={{ color: colors.put }}>Put {amount(window.activity?.put)}</span><span className={styles.intensity}>活动 {window.intensity === null ? '—' : `${window.intensity.toFixed(2)}×`}{window.intensity!==null&&<meter min={0} max={3} low={1} high={1.5} optimum={1} value={Math.min(3,window.intensity??0)} aria-label="相对近期活动强度"/>}</span></div>
      {window.activity&&window.activity.total>0&&<div className={styles.balanceBar} aria-label="Call / Put 活动占比"><i style={{width:`${window.activity.call/window.activity.total*100}%`,background:colors.call}}/><i style={{flex:1,background:colors.put}}/></div>}
      <svg viewBox={`0 0 ${width} 98`} className={styles.observationChart} role="img" aria-label="Delta 加权新增成交活跃度">
        <text x={plotLeft} y="13" fill="#929cab" fontSize="10">新增成交 · Delta 加权</text>{axis(activityMax, false)}
        {visible.map(point => point.activity ? <g key={point.time}><title>{`${time.format(point.time)} ET · Call ${amount(point.activity.call)} · Put ${amount(point.activity.put)} · ${point.activity.contracts} 张 · ${((point.time - point.from) / 60_000).toFixed(1)} 分钟`}</title>
          <rect x={x(point.time) - 2} y={84 - point.activity.call / activityMax * 57} width="4" height={point.activity.call / activityMax * 57} fill={colors.call} />
          <rect x={x(point.time) - 2} y={84 - point.activity.total / activityMax * 57} width="4" height={point.activity.put / activityMax * 57} fill={colors.put} /></g> : null)}
      </svg>
      <small className={window.activityReason?styles.warningChip:undefined}>{window.activityReason ?? (window.activity?`${window.activity.contracts.toLocaleString()} 张新增成交`:'当前窗口暂无有效成交')}</small></> : <QqqObservationEmpty>{loading||error?unavailable:window.activityReason??'等待相邻快照中的有效成交记录。'}</QqqObservationEmpty>}
    </article>}
    {flags.hedge && <article className={styles.observationCard}>
      {title('模型再对冲', window.hedge ? `${amount(window.hedge.total)}${window.hedgePartial?'（部分）':''}` : '—')}
      {visible.some(point=>point.hedge) ? <><div className={styles.observationMetrics}><span style={{ color: colors.price }}>价格 {amount(window.hedge?.price)}</span><span style={{ color: colors.time }}>时间 {amount(window.hedge?.time)}</span><span style={{ color: colors.iv }}>IV {amount(window.hedge?.iv)}</span></div>
      {window.hedge&&<div className={styles.balanceBar} aria-label="模型贡献绝对规模占比">{(['price','time','iv'] as const).map(key=><i key={key} title={`${key}: ${amount(window.hedge![key])}`} style={{flex:Math.abs(window.hedge![key]),background:colors[key]}}/>)}</div>}
      <svg viewBox={`0 0 ${width} 98`} className={styles.observationChart} role="img" aria-label="模型再对冲变化与贡献">
        <text x={plotLeft} y="13" fill="#929cab" fontSize="10">对冲调整 · 美元</text>{axis(hedgeMax, true)}
        {visible.map(point => point.hedge ? <g key={point.time}><title>{`${time.format(point.time)} ET · 合计 ${amount(point.hedge.total)} · 价格 ${amount(point.hedge.price)} · 时间 ${amount(point.hedge.time)} · IV ${amount(point.hedge.iv)} · ${point.hedge.shares.toFixed(0)} 股`}</title>
          {(['price', 'time', 'iv'] as const).map((key, i) => { const height = point.hedge![key] / hedgeMax * 28; return <rect key={key} x={x(point.time) - 3 + i * 2} y={height >= 0 ? 55 - height : 55} width="2" height={Math.abs(height)} fill={colors[key]} />; })}
          <circle cx={x(point.time)} cy={55 - point.hedge.total / hedgeMax * 28} r="1.3" fill="#e5e7eb" /></g> : null)}
      </svg>
      <small className={window.hedgeReason?styles.warningChip:undefined}>{window.hedgeReason ?? (window.hedge?`模型调整 ${window.hedge.shares.toLocaleString(undefined, { maximumFractionDigits: 0 })} 股`:'当前窗口暂无有效模型调整')}</small></> : <QqqObservationEmpty>{loading||error?unavailable:window.hedgeReason??'等待完整的持仓、IV 与价格快照。'}</QqqObservationEmpty>}
    </article>}
    {flags.response && <article className={styles.observationCard}>
      {title('价格响应', window.pricePct === null ? '—' : `${window.pricePct >= 0 ? '+' : ''}${window.pricePct.toFixed(2)}%`)}
      {window.pricePct !== null || visible.some(point=>point.activityRatio!==null||point.hedge) ? <><div className={styles.responseBadges}><span>{window.response}</span><span>{window.alignment}</span><span>{window.last?.spot != null && window.last.vwap != null ? `${window.last.spot >= window.last.vwap ? '高于' : '低于'} VWAP ${((window.last.spot / window.last.vwap - 1) * 100).toFixed(2)}%` : 'VWAP 数据不足'}</span></div>
      <svg viewBox={`0 0 ${width} 100`} className={styles.responseChart} role="img" aria-label={`近 ${minutes} 分钟滚动价格响应`}>
        <text x={plotLeft - 8} y="31" textAnchor="end" fill="#929cab" fontSize="9">涨跌</text>
        <line x1={plotLeft} x2={plotRight} y1="28" y2="28" stroke="#52586a" opacity=".35" strokeDasharray="3 4" />
        <text x={plotRight + 8} y="13" fill="#929cab" fontSize="9">+{responseMax.toFixed(2)}%</text>
        <text x={plotRight + 8} y="49" fill="#929cab" fontSize="9">−{responseMax.toFixed(2)}%</text>
        <path d={responsePath} fill="none" stroke="#60a5fa" strokeWidth="1.5"><title>{`各时点近 ${minutes} 分钟涨跌幅；空缺表示价格数据不足`}</title></path>
        <text x={plotLeft - 8} y="68" textAnchor="end" fill="#929cab" fontSize="9">活动</text><text x={plotLeft - 8} y="89" textAnchor="end" fill="#929cab" fontSize="9">背离</text>
        {[65, 86].map(y => <line key={y} x1={plotLeft} x2={plotRight} y1={y} y2={y} stroke="#52586a" opacity=".3" />)}
        {visibleResponses.map(point => {
          const amplified = point.intensity !== null && point.intensity >= 1.5;
          const divergent = point.alignment === '价格与模型背离';
          return <g key={point.time}><title>{`${time.format(point.time)} ET · 近 ${minutes} 分钟 · ${point.pricePct === null ? '价格数据不足' : `${point.pricePct.toFixed(2)}%`} · ${point.response} · ${point.alignment}`}</title>
            {point.intensity !== null && <circle cx={x(point.time)} cy="65" r={amplified ? 2.5 : 1.2} fill={amplified ? '#d4b16a' : '#697586'} />}
            {divergent && <circle cx={x(point.time)} cy="86" r="2.5" fill="#c4a5ff" />}</g>;
        })}
      </svg>
      <small>近 {minutes} 分钟滚动 · 金点活动放大 · 灰点未放大 · 紫点模型背离</small>
      </> : <QqqObservationEmpty>等待观察窗口内的完整期权与价格快照。</QqqObservationEmpty>}
    </article>}
    <div className={styles.dataStrip}><span>{scopeLabel} · 持仓模型估算</span><QqqInfoTooltip label="活动与再对冲计算说明" content={<><p>活动强度 = 相邻快照新增成交量 × |Delta| × 100 × 当时价格；Delta 使用当时 IV 重算。每个再对冲区间固定前一快照 OI，按价格 → 时间 → IV 顺序分解，先计算对冲股数变化，再按区间末价格换算美元。窗口美元值为各区间名义金额之和。Call 正 / Put 负、利率和股息为零、合约乘数 100；贡献随分解顺序变化，不代表实际做市商持仓或成交方向。贡献比例条按各项绝对规模显示，不代表净值。</p><p>窗口边界吸收 30 秒接收时间差，否则最多向前查找两分钟，并展示实际时长。缺少部分 OI 或 IV 时仅计算前一快照持仓量与两端 IV 有效的合约，并标记部分估算；窗口仅汇总各段共同有效的持仓合约，剔除合约时标记部分估算。活动强度仅估算成交量与 IV 有效的新增成交，窗口与前期基线按共同有效合约比较，部分估算不代表全部活动。个别合约缺少成交量时剔除并标记部分估算；缺少已收盘价格、超过五分钟断档、累计成交量回退或无共同有效合约时，对应指标留空。两分钟 bid/ask 和接收时间用于报价快照观察，不能作为逐笔成交当时的报价。价格响应阈值为观察规则，尚未验证预测能力。</p></>}/></div>
  </section>;
}
export default memo(QqqHedgeObservationPanels);
