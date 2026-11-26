'use client';
import { useEffect, useState } from 'react';
import styles from './QqqGexRequestFeedback.module.css';

export default function QqqGexRequestFeedback({ pending, blocking = false, offline, error, label, asOf, retryAttempt = 0, onRetry }: {
  pending: boolean; blocking?: boolean; offline: boolean; error: string | null; label: string; asOf?: string; retryAttempt?: number; onRetry: () => void;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { if (!pending) {setVisible(false);return;} const timer = setTimeout(()=>setVisible(true),300); return()=>clearTimeout(timer); }, [pending, label]);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    if (!pending) return;
    const start = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [pending, label]);
  if ((!pending && !offline && !error) || (pending && !visible && !offline && !error)) return null;
  const slow = seconds >= 8;
  if (pending && !blocking && !slow && !offline && !error) return null;
  const title = offline ? '网络已断开' : error && !pending ? '数据未能更新' : slow ? '加载比平时慢' : label;
  const detail = offline ? asOf ? '已有图表已保留；网络恢复后自动重试。' : '请检查网络连接，恢复后自动加载。' : error && !pending ? asOf ? '已有数据已保留。可立即重试，或继续查看历史快照。' : '服务暂时未能返回数据，请重试。' : slow ? '正在等待服务响应，可以重新加载；不会清空已有图表。' : blocking ? '正在读取行情和期权结构，请稍候。' : '图表可继续操作，更新完成后自动同步。';
  return <div className={blocking ? styles.mask : styles.banner}>
    <div className={styles.card} role={offline || error && !pending ? 'alert' : 'status'} aria-live="polite">
      <div className={styles.row}><strong>{pending && !offline && <span className={styles.spinner} aria-hidden="true" />}{title}</strong><small aria-live="off">{pending && `${seconds} 秒`}</small></div>
      <p>{detail}</p>
      {asOf && <small>当前快照：{new Date(asOf).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })} 北京时间</small>}
      {retryAttempt > 0 && error && !pending && <small>{retryAttempt < 3 ? `自动重试 ${retryAttempt}/3` : '自动重试已达上限，请手动重试。'}</small>}
      {(offline || error || slow) && <div className={styles.actions}><button type="button" onClick={onRetry} disabled={offline}>{pending ? '重新加载' : '立即重试'}</button>{error && <details><summary>错误详情</summary><p>{error}</p></details>}</div>}
    </div>
  </div>;
}
