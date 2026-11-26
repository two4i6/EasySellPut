import DisplayPrices from './stock-display';
import React, { createContext, useContext, useEffect, useState } from 'react';
import OriginalDateRail from '../upstream/src/components/Strategy/qqq/QqqGexDateRail';
import { qqqEasternDateKey } from '../upstream/src/lib/qqqMarketDate';
// Presentation only: the same bounded read-only archive backs UI and MCP.
// A partial day never borrows the previous published day or authorizes a signal.
type WorkspaceDates = {
    partialDates: string[];
    select: (date: string) => void;
    remember: (dates: readonly string[]) => void;
    notePublished: (date: string) => void;
};
const Context = createContext<WorkspaceDates | null>(null);
const key = 'qqq-gex:workbench-date:v1';
const valid = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const et = (value: string) => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) : '未知';
export function UnifiedDateRail(props: React.ComponentProps<typeof OriginalDateRail>) {
    const workspace = useContext(Context);
    useEffect(() => { if (workspace)
        workspace.remember(props.dates); }, [props.dates, workspace?.remember]);
    useEffect(() => { if (workspace && valid(props.selectedDate))
        workspace.notePublished(props.selectedDate); }, [props.selectedDate, workspace?.notePublished]);
    if (!workspace)
        return <OriginalDateRail {...props}/>;
    return <OriginalDateRail {...props} dates={[...props.dates, ...workspace.partialDates]} onDateSelect={date => { workspace.select(date); if (!workspace.partialDates.includes(date))
        props.onDateSelect(date); }}/>;
}
export default function PartialWorkspace({ partial, latestDate, revision, children }: {
    partial: any;
    latestDate: string | null;
    revision: string;
    children: React.ReactNode;
}) {
    const [indexReady, setIndexReady] = useState(false), [indexError, setIndexError] = useState(''), [indexRetry, setIndexRetry] = useState(0);
    const [partialDates, setPartialDates] = useState<string[]>(() => valid(partial?.date) && partial.date !== latestDate ? [partial.date] : []);
    const [knownDates, setKnownDates] = useState<string[]>(() => latestDate ? [latestDate] : []);
    const [selected, setSelected] = useState<string | null>(() => { const saved = localStorage.getItem(key); const chosen = valid(saved) ? saved : valid(partial?.date) && (!latestDate || partial.date > latestDate) ? partial.date : null; if (chosen) {
        localStorage.setItem('qqq-gex:snapshot-date:v1', chosen);
        localStorage.setItem('qqq-gex:date-mode:v1', 'fixed');
    } return chosen; });
    const notePublished = React.useCallback((date: string) => { setSelected(date); localStorage.setItem(key, date); }, []);
    const remember = React.useCallback((dates: readonly string[]) => setKnownDates(old => { const next = [...new Set([...old, ...dates])].sort(); return next.join() === old.join() ? old : next; }), []);
    function select(date: string) { setSelected(date); localStorage.setItem(key, date); localStorage.setItem('qqq-gex:snapshot-date:v1', date); localStorage.setItem('qqq-gex:date-mode:v1', 'fixed'); }
    useEffect(() => {
        const controller = new AbortController();
        async function index(archiveState: string) {
            const dates: string[] = [];
            let page = 1, revision: string | undefined;
            do {
                const query = new URLSearchParams({ resource: 'dates', archiveState, page: String(page), pageSize: '200', ...(revision ? { revision } : {}) });
                const response = await fetch('/api/analysis/qqq/local-archive?' + query, { signal: controller.signal });
                if (!response.ok)
                    throw Error('日期索引暂不可读');
                const value = await response.json();
                if (!value.available || value.status === 'revision_changed')
                    throw Error('日期索引已更新，请重试');
                dates.push(...value.items.map((item: any) => item.date).filter(valid));
                revision = value.revision;
                if (!value.hasMore)
                    return dates;
                page++;
            } while (page <= 250);
            throw Error('日期索引超出读取上限');
        }
        Promise.all([index('partial'), index('published')]).then(([partialDates, publishedDates]) => {
            if (!controller.signal.aborted) {
                setPartialDates(partialDates);
                setKnownDates(publishedDates);
                setIndexReady(true);
                setIndexError('');
            }
        }).catch(error => { if (!controller.signal.aborted)
            setIndexError(error.message); });
        return () => controller.abort();
    }, [revision, indexRetry]);
    useEffect(() => { if (valid(partial?.date) && partial.date !== latestDate)
        setPartialDates(old => old.includes(partial.date) ? old : [...old, partial.date]); if (latestDate) {
        remember([latestDate]);
        setPartialDates(old => old.filter(date => date !== latestDate));
    } }, [partial?.date, latestDate, remember]);
    // A cold cache may receive its first partial capture after this view mounted.
    // Restore only an indexed day; never strand a stale preference on an empty chart.
    useEffect(() => {
        if (!indexReady) return;
        const available = [...new Set([...knownDates, ...partialDates])].sort();
        if (selected && available.includes(selected)) return;
        const next = available.at(-1);
        if (next) select(next);
        else if (selected) setSelected(null);
    }, [indexReady, knownDates, partialDates, selected]);
    const isPartial = Boolean(selected && partialDates.includes(selected) && selected !== latestDate);
    const pending = Boolean(selected && !partialDates.includes(selected) && selected !== latestDate && !indexReady);
    useEffect(() => { if (selected) {
        localStorage.setItem('qqq-local:observed-workbench:v1', JSON.stringify({ observedAt: new Date().toISOString(), date: selected, archiveState: pending ? 'loading' : isPartial ? 'partial' : 'published', complete: false }));
        document.title = `QQQ GEX · ${selected}${isPartial ? ' · 部分采集' : ''}`;
    } }, [selected, isPartial, pending]);
    return <Context.Provider value={{ partialDates, select, remember, notePublished }}>{indexError && !pending && <div className="qqq-local-notice" role="status" title={indexError}>日期未更新 <button onClick={() => setIndexRetry(value => value + 1)}>重试</button></div>}{pending ? <p role="status">{indexError || '正在读取日期…'}{indexError && <button onClick={() => setIndexRetry(value => value + 1)}>重试</button>}</p> : isPartial ? <section className="qqq-partial-workspace" aria-label="部分采集工作台" key={selected}>
 <header><strong>QQQ</strong><span role="status">部分采集</span><OriginalDateRail compact dates={[...knownDates, ...partialDates]} selectedDate={selected} onDateSelect={select}/></header>
 <PartialDay date={selected!} revision={revision}/>
 </section> : selected?<DisplayPrices key={selected} date={selected} archiveState="published" revision={revision}><div className="qqq-model-workspace">{children}</div></DisplayPrices>:<div className="qqq-model-workspace">{children}</div>}</Context.Provider>;
}
async function archive(args: Record<string, string>, signal: AbortSignal) { const r = await fetch('/api/analysis/qqq/local-archive?' + new URLSearchParams({ archiveState: 'partial', pageSize: '200', ...args }), { signal }); if (!r.ok)
    throw Error('本地输入暂不可读'); const value = await r.json(); if (!value.available)
    throw Error(value.status === 'revision_changed' ? '采集已更新，请重试' : '该日部分输入不可读'); if (args.date && value.scope?.date !== args.date)
    throw Error('数据日期不匹配'); return value; }
function PartialDay({ date, revision }: {
    date: string;
    revision: string;
}) {
    const preferred = React.useRef<{
        expiry?: string;
        capturedAt?: string;
    }>({});
    const [snapshotPage, setSnapshotPage] = useState(0), [listing, setListing] = useState<any>(null), [snapshots, setSnapshots] = useState<any[]>([]), [snapshot, setSnapshot] = useState(''), [bars, setBars] = useState<any>(null), [profile, setProfile] = useState<any>(null), [meta, setMeta] = useState<any>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0), [barResource, setBarResource] = useState('extendedBars'), [barPage, setBarPage] = useState(1), [profilePage, setProfilePage] = useState(1);
    useEffect(() => { const c = new AbortController(); setSnapshots([]); setSnapshot(''); setBars(null); setProfile(null); setMeta(null); setError(''); (async () => { let value = await archive({ resource: 'snapshots', date, page: String(snapshotPage || 1) }, c.signal); if (!snapshotPage && value.total > 200)
        value = await archive({ resource: 'snapshots', date, page: String(Math.ceil(value.total / 200)), revision: value.revision }, c.signal); const rows = value.items; if (rows.some((row: any) => qqqEasternDateKey(row.capturedAt) !== date))
        throw Error('期权输入跨日，已停止显示'); if (!c.signal.aborted) {
        setMeta(value);
        setListing(value);
        setSnapshots(rows);
        const latest = rows.at(-1)?.capturedAt;
        let index = rows.findIndex((row: any) => row.expiryDate === preferred.current.expiry && row.capturedAt === preferred.current.capturedAt);
        if (index < 0)
            index = rows.findIndex((row: any) => row.expiryDate === preferred.current.expiry && row.capturedAt === latest);
        if (index < 0)
            index = rows.findIndex((row: any) => row.capturedAt === latest);
        setSnapshot(rows.length ? String(index) : '');
    } })().catch(e => { if (!c.signal.aborted)
        setError(e.message); }); return () => c.abort(); }, [date, revision, retry, snapshotPage]);
    const current = snapshots[Number(snapshot)];
    useEffect(()=>{if(meta?.displayPricesAvailable)setBarResource(meta.displayRegularCount?'bars':'extendedBars');},[meta?.displayPricesAvailable,Boolean(meta?.displayRegularCount)]);
    useEffect(() => { if (!meta)
        return; const c = new AbortController(); setBars(null); archive({ resource: barResource, ...(meta.displayPricesAvailable?{priceBasis:'display'}:{}), date, page: String(barPage), revision: meta.revision }, c.signal).then(value => { if (value.items.some((b: any) => qqqEasternDateKey(b.timestamp) !== date))
        throw Error('价格输入跨日，已停止显示'); if (!c.signal.aborted) {
        const last = Math.max(1, Math.ceil(value.total / 200));
        if (barPage > last)
            setBarPage(last);
        else
            setBars(value);
    } }).catch(e => { if (!c.signal.aborted)
        setError(e.message); }); return () => c.abort(); }, [date, meta, barPage, barResource]);
    useEffect(() => { setProfile(null); if (!current || !meta)
        return; const c = new AbortController(); archive({ resource: 'profile', date, expiry: current.expiryDate, capturedAt: current.capturedAt, page: String(profilePage), revision: meta.revision }, c.signal).then(value => { if (!c.signal.aborted) {
        const last = Math.max(1, Math.ceil(value.total / 200));
        if (profilePage > last)
            setProfilePage(last);
        else
            setProfile(value);
    } }).catch(e => { if (!c.signal.aborted)
        setError(e.message); }); return () => c.abort(); }, [date, current, meta, profilePage]);
    useEffect(() => { localStorage.setItem('qqq-local:observed-partial:v1', JSON.stringify({ observedAt: new Date().toISOString(), date, archiveState: 'partial', revision: meta?.revision ?? null, expiry: current?.expiryDate ?? null, capturedAt: current?.capturedAt ?? null, snapshotPage: listing?.page ?? null, barResource, barPage, profilePage, complete: false })); }, [date, meta, current, listing, barResource, barPage, profilePage]);
    return <><div className="qqq-partial-quality"><span>{meta?.source ?? '本地'} · 延迟来源</span><span>期权报价 {current?.quoteTiming?.optionQuoteAt ? et(current.quoteTiming.optionQuoteAt) + ' ET' : '未核实'}</span><span>估值 {current?.capturedAt ? et(current.capturedAt) + ' ET' : '未知'}</span><span>标的成交 {meta?.underlyingLastTradeAt ? et(meta.underlyingLastTradeAt) + ' ET' : '未知'}</span><details><summary>数据质量</summary><p>盘前盘后价格与期权输入独立显示，未对齐时不生成完整回放或信号。</p>{meta?.issues?.map((issue: string) => <p key={issue}>{issue}</p>)}<pre>{JSON.stringify(meta?.barProvenance, null, 2)}</pre></details></div>
 {error && <div role="alert">{error} <button onClick={() => { setError(''); setRetry(n => n + 1); }}>重试</button></div>}
 <div className="qqq-partial-grid"><section aria-label="盘前盘后价格"><h3>{meta?.displayPricesAvailable?'股票行情':'估值价格'} <small>{bars?.barProvenance?.Source ?? bars?.barProvenance?.source ?? '来源未知'} · {bars?.total ?? '…'} 桶</small></h3><select aria-label="价格时段" value={barResource} onChange={e => { setBarResource(e.target.value); setBarPage(1); }}><option value="extendedBars">盘前 / 盘后</option><option value="bars">常规时段</option></select><PricePlot bars={bars?.items ?? []} candles={Boolean(meta?.displayPricesAvailable)}/><Pages value={bars} page={barPage} select={setBarPage}/></section>
 <section aria-label="可用期权输入"><h3>期权输入 <small>{meta?.source ?? '来源未知'} · {listing?.total ?? '…'} 快照</small></h3><select aria-label="期权输入快照" value={snapshot} onChange={e => { const chosen = snapshots[Number(e.target.value)]; preferred.current = { expiry: chosen?.expiryDate, capturedAt: chosen?.capturedAt }; setSnapshot(e.target.value); setProfilePage(1); }} disabled={!snapshots.length}>{snapshots.map((row, index) => <option key={row.capturedAt + '|' + row.expiryDate} value={index}>{row.expiryDate} · {et(row.capturedAt)} ET</option>)}</select><Pages value={listing} page={listing?.page ?? 1} select={page => { preferred.current = { expiry: current?.expiryDate }; setSnapshotPage(page); }}/>
 <div className="qqq-partial-quality"><span>{current?.modelInputComplete ?? current?.inputComplete ? 'OI/IV 有效' : 'OI/IV 缺失'}</span><span>{current?.sourceTimeAligned === false ? '源时间未核实' : '源时间见快照'}</span><span>GEX / 1% {number(current?.netGex)}</span></div>
 <div className="qqq-partial-scroll"><table><thead><tr><th>执行价</th><th>Call GEX</th><th>Put GEX</th><th>净 GEX</th><th>Call IV</th><th>Put IV</th><th>Call OI</th><th>Put OI</th></tr></thead><tbody>{profile?.items?.map((row: any, index: number) => <tr key={index}><td>{number(row.strike)}</td><td>{number(row.callGex)}</td><td>{number(row.putGex)}</td><td>{number(row.totalGex)}</td><td>{percent(row.callIv)}</td><td>{percent(row.putIv)}</td><td>{number(row.callOi)}</td><td>{number(row.putOi)}</td></tr>)}</tbody></table></div><Pages value={profile} page={profilePage} select={setProfilePage}/><details><summary>快照原始字段</summary><pre>{JSON.stringify({ snapshot: profile?.snapshot ?? current, profile: profile?.items }, null, 2)}</pre></details></section></div></>;
}
function percent(value: any) { return typeof value === 'number' && Number.isFinite(value) && value > 0 ? new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 }).format(value) : '—'; }
function number(value: any) { return typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value) : '—'; }
function Pages({ value, page, select }: {
    value: any;
    page: number;
    select: (page: number) => void;
}) { return <nav aria-label="输入分页"><button disabled={!value || page <= 1} onClick={() => select(page - 1)}>上一页</button><span>{page} · {value?.total ?? '…'} 项</span><button disabled={!value?.hasMore} onClick={() => select(page + 1)}>下一页</button></nav>; }
export function PricePlot({ bars, candles=false }: {
    candles?:boolean;
    bars: any[];
}) {
    const points = bars.filter(bar => Number.isFinite(bar.close) && Number.isFinite(Date.parse(bar.timestamp)));
    if (!points.length)
        return <p role="status">暂无所选时段价格</p>;
    const times = points.map(p => Date.parse(p.timestamp)), prices = points.map(p => p.close), first = Math.min(...times), last = Math.max(...times), low = Math.min(...(candles?points.map(p=>p.low):prices)), high = Math.max(...(candles?points.map(p=>p.high):prices)), x = (time: number) => 30 + 740 * (time - first) / Math.max(1, last - first), y = (price: number) => 210 - 170 * (price - low) / Math.max(.01, high - low);
    let path = '';
    points.forEach((point, index) => { path += (index && times[index] - times[index - 1] <= 120000 ? 'L' : 'M') + x(times[index]) + ',' + y(point.close); });
    return <><strong>{number(points.at(-1).close)}</strong><svg viewBox="0 0 800 250" role="img" aria-label={`同日价格，${et(points[0].timestamp)} 至 ${et(points.at(-1).timestamp)} ET，共 ${points.length} 个原始桶；缺口不补齐`}><text x="30" y="30" fill="currentColor">{number(high)}</text><text x="30" y="210" fill="currentColor">{number(low)}</text>{!candles&&<path d={path} fill="none" stroke="var(--accent-color,var(--text-primary))" strokeWidth="2"/>}{candles?points.map((p,i)=>{const color=p.close>=p.open?'var(--accent-success)':'var(--accent-danger)';const width=Math.max(1,Math.min(5,600/points.length));return <g key={i} aria-label={`${et(p.timestamp)} ET O ${p.open} H ${p.high} L ${p.low} C ${p.close}`}><line x1={x(times[i])} x2={x(times[i])} y1={y(p.high)} y2={y(p.low)} stroke={color}/><rect x={x(times[i])-width/2} y={Math.min(y(p.open),y(p.close))} width={width} height={Math.max(1,Math.abs(y(p.open)-y(p.close)))} fill={color}/><title>{et(p.timestamp)} ET · O {p.open} H {p.high} L {p.low} C {p.close}</title></g>;}):points.map((p, i) => <circle key={i} cx={x(times[i])} cy={y(p.close)} r="2" fill="currentColor"><title>{et(p.timestamp)} ET · {p.close}</title></circle>)}<text x="30" y="235" fill="currentColor">{et(points[0].timestamp)} ET</text><text x="770" y="235" textAnchor="end" fill="currentColor">{et(points.at(-1).timestamp)} ET</text></svg><details><summary>价格原始字段</summary><pre>{JSON.stringify(points, null, 2)}</pre></details></>;
}
