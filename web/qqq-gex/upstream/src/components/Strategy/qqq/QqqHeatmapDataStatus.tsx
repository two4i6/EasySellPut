import type {heatmapCoverage,heatmapDefinition,HeatmapContrast} from '@/lib/qqqHeatmapPresentation';
import QqqInfoTooltip from './QqqInfoTooltip';
import styles from './QqqExposureWorkbench.module.css';
export default function QqqHeatmapDataStatus({coverage,definition,contrast,history}:{coverage:ReturnType<typeof heatmapCoverage>;definition:ReturnType<typeof heatmapDefinition>;contrast?:HeatmapContrast;history:'loading'|'complete'|'partial'|'error'}){
 return <div className={styles.coverageStatus} role="status" aria-label="行权价数据覆盖与计算口径">
  <span className={coverage?.unavailable?styles.coverageWarning:undefined}>{coverage?`可见行权价有效 ${coverage.valid} / ${coverage.total}`:'正在核对可见行权价'}</span>
  {coverage&&coverage.unavailable>0&&<span>留空 {coverage.unavailable} 档</span>}
  <span className={definition.legacy?styles.coverageWarning:undefined}>{definition.label}</span><QqqInfoTooltip label="计算口径说明" content={definition.detail}/>
  <span className={history==='error'||history==='partial'?styles.coverageWarning:undefined}>{history==='complete'?'完整历史已载入':history==='loading'?'完整历史读取中':history==='error'?'历史读取失败 · 仅显示已收到快照':'仅显示已收到快照'}</span>
  <details className={styles.coverageDetails}><summary>覆盖详情{contrast?'与色阶':''}</summary><div>
  {coverage&&coverage.invalidIv>0&&<span>无效 IV {coverage.invalidIv} 档</span>}
  {coverage&&coverage.missingOi>0&&<span>缺失 OI {coverage.missingOi} 档</span>}
  {coverage&&coverage.unrecordedSide>0&&<span className={styles.coverageWarning}>旧记录未保存一侧 IV {coverage.unrecordedSide} 档</span>}
  {coverage&&coverage.missingExpiries>0&&<span>缺少 {coverage.missingExpiries} 个到期日</span>}
  <QqqInfoTooltip label="有效行权价覆盖说明" content="仅统计当前回放快照、当前可见价格范围。有效数按当前图表实际可用值统计，真实零值也计入；无效输入、缺失快照与不可计算项留空。OI / IV 原因可以重叠；不以零值补齐。旧记录即使有保存值，也不能证明被旧采集器删除的一侧持仓为零。"/>
  {contrast&&<span>{contrast==='enhanced'?'增强弱值 · 对数色阶':'历史绝对值色阶'}</span>}
  </div></details>
 </div>;
}
