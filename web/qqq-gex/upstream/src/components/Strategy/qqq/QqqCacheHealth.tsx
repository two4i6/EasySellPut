'use client';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent, PopoverTitle } from '@/components/ui/popover';
import styles from './QqqCacheHealth.module.css';
import useAppSWR from '@/hooks/useAppSWR';
import { qqqMarketSession } from '@/lib/qqqMarketSession';
const labels: Record<string,string> = {COLLECTOR_NOT_CONFIGURED:'采集连接尚未配置',MONITOR_UNAVAILABLE:'采集状态暂时不可用',
 OPTION_COLLECTOR_STALE:'期权链采集已延迟',STOCK_CANDLES_STALE:'K线采集已延迟',COLLECTOR_FAILURES:'过去24小时有采集或归档失败记录',PARTIAL_CAPTURES:'过去24小时有不完整采集或归档记录',UNARCHIVED_EXPIRED_ROWS:'存在未归档的过期数据，请先归档'};
export default function QqqCacheHealth({ compact = false, children, inputQuality }: { compact?: boolean; children?: ReactNode; inputQuality?: string | null }){
 const {data,error} = useAppSWR('qqq-cache-health-v1',async()=>{
  const response=await fetch('/api/analysis/qqq/cache-status',{signal:AbortSignal.timeout(12000)});
  return response.json();
 },{refreshInterval:300000,dedupingInterval:300000,revalidateOnFocus:false,revalidateOnReconnect:false,refreshWhenHidden:false,shouldRetryOnError:false,showErrorToast:false});
 const open=data?.session?.optionsOpen ?? qqqMarketSession().optionsOpen;
 const time=data?.latestChainAt ? new Date(data.latestChainAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : '暂无有效采集';
 const unavailable = Boolean(error) || data?.status === 'UNAVAILABLE';
 const warnings: string[] = data?.alerts ?? (error ? ['MONITOR_UNAVAILABLE'] : []);
 const attention = unavailable || data?.status === 'UNCONFIGURED' || warnings.length > 0 || Boolean(inputQuality);
 const summary = unavailable ? '状态不可用' : !data ? '状态加载中' : data.status === 'UNCONFIGURED' ? '采集待连接' : attention ? '采集异常' : open ? '采集正常' : '休市快照';
 const details = <div className={styles.details}>
  {children}
  <div className={styles.source}>
   <strong>实时采集状态</strong>
   {inputQuality && <p className={styles.warnings}>{inputQuality} 主图 GEX 横线与标注为“部分”的数值仅基于有效输入。</p>}
   <p>{!data || data.status==='UNCONFIGURED' || unavailable ? '统一采集待连接' : open ? '统一期权采集 · 每2分钟更新' : '期权休市 · 使用最后有效快照'}</p>
   <p>数据时间（北京时间）：{time}</p>
   {data?.archiveCount !== undefined && <p>已验证归档 {data.archiveCount} 份</p>}
   {warnings.some(code => ['COLLECTOR_FAILURES','PARTIAL_CAPTURES'].includes(code)) && <p>历史记录：以下24小时异常计数不代表当前仍在断流。</p>}
   {data?.latestCandleAt && <p>股票K线时间（北京时间）：{new Date(data.latestCandleAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}</p>}
   {warnings.length > 0 && <ul className={styles.warnings}>{warnings.filter(code=>code!=='PARTIAL_CAPTURES'||!inputQuality).map((code:string)=><li key={code}>{labels[code] ?? '数据完整性需要检查'}</li>)}</ul>}
  </div>
 </div>;
 if (!compact) return details;
 return <Popover><PopoverTrigger className={styles.trigger} data-attention={attention} aria-label={`运行详情：${summary}`}><span className={styles.dot} />{summary}<ChevronDown size={11} /></PopoverTrigger>
  <PopoverContent positionerClassName={styles.positioner} className={styles.popup}><PopoverTitle className={styles.title}>运行详情</PopoverTitle>{details}</PopoverContent>
 </Popover>;
}
