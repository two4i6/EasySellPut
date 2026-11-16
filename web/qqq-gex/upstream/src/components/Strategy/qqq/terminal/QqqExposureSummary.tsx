import { qqqGexProfileObservation } from '@/lib/qqqGexObservationComparison';
import { qqqOptionOverview } from '@/lib/qqqOptionObservation';
import { exposureReplayModelTotals, exposureReplayTableRows, type QqqExposureReplayContext } from '@/lib/qqqExposureReplay';
import type { QqqGammaModel } from '@/lib/qqqGammaModel';
import { formatQqqMatrixGex } from '../qqqGexMatrixModel';
import { useMemo } from 'react';
import { QqqObservationHeading } from './QqqObservationUi';
import styles from './QqqObservationCards.module.css';

/** Reuses the replay compatibility contract and activity aggregation, without fetching. */
export default function QqqExposureSummary({ replay, model }: { replay: QqqExposureReplayContext | null; model?: QqqGammaModel }) {
  const summary = useMemo(() => {
    if (!replay?.frame) return null;
    const row = exposureReplayTableRows([replay.frame], replay.bars)[0]!;
    const points = replay.frame.profiles.filter(profile=>(profile.time??replay.frame!.time)<=replay.frame!.time).flatMap(profile => profile.strikes);
    const overview = row.displayNet!==null||qqqGexProfileObservation(points).supported ? qqqOptionOverview(points) : null;
    const recalculated = row.displayNet === null ? exposureReplayModelTotals(replay.frame, model) : null;
    const net = row.displayNet ?? recalculated?.net ?? null;
    const activity = {call:{absoluteGex:recalculated?.call ?? overview?.call.absoluteGex ?? null},put:{absoluteGex:recalculated?.put ?? overview?.put.absoluteGex ?? null}};
    return { activity, net, recalculated, partial:row.partial||Boolean(overview&&(overview.call.gexCoverage<overview.strikes||overview.put.gexCoverage<overview.strikes)), coverage:`${row.validStrikes}/${row.totalStrikes}` };
  }, [replay, model]);
  if (!summary) return null;
  const { activity, net, recalculated, partial, coverage } = summary;
  const total = activity.call.absoluteGex!==null&&activity.put.absoluteGex!==null?activity.call.absoluteGex+activity.put.absoluteGex:0;
  return <section aria-label="回放暴露摘要" style={{ margin: '0', padding: '8px 0' }}><QqqObservationHeading title="暴露摘要" meta={partial?`部分数据 · ${coverage} 行权价`:undefined} info={partial?'绝对量按各侧有效输入合计；净 GEX 仅合计双侧有效的行权价。缺失 OI / IV 未补零。数值与完整期权链可能不同。':net===null?'覆盖缺失或历史口径不完整，暂不合计。':recalculated?'持仓模型重算，每 1% 价格变动美元暴露。Call 正 / Put 负假设。':'显示所选范围的 Call / Put 绝对暴露；净暴露描述 Gamma 状态，不代表价格方向。'}/>
    <div className={styles.summary}>
      <div><small>Call 绝对量</small><strong style={{ color: '#60a5fa' }}>{formatQqqMatrixGex(activity.call.absoluteGex)}</strong></div>
      <div><small>Put 绝对量</small><strong style={{ color: '#fb923c' }}>{formatQqqMatrixGex(activity.put.absoluteGex)}</strong></div>
      <div><small>净 GEX{partial?'（部分）':''}</small><strong style={{color:net==null?'#d4b16a':net>=0?'#2dd4bf':'#fb923c'}}>{net === null ? '无法合计' : formatQqqMatrixGex(net)}</strong></div>
    </div>
    <div className={styles.shareBar} style={{marginTop:8,height:4}} aria-label="Call / Put 绝对暴露占比">{total>0&&<><span style={{width:`${(activity.call.absoluteGex??0)/total*100}%`,background:'#60a5fa'}}/><span style={{flex:1,background:'#fb923c'}}/></>}</div>
  </section>;
}
