'use client';

import { createContext, memo, useContext, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Tooltip } from '@base-ui/react/tooltip';
import styles from './QqqTerminalWorkspace.module.css';
import { qqqTerminalTabEventIndex, qqqTerminalTabStorageValue, resolveQqqTerminalTabIndex } from './terminal/qqqTerminalTabsModel';
import { createQqqLayoutFrame } from './terminal/qqqLayoutFrame';

const defaultLayoutStorageKey = 'qqq-gex:workspace-layout:v1';
const minTableHeight = 76;
const clampTableHeight = (height: number, available: number) => Math.round(Math.max(minTableHeight, Math.min(height, Math.max(minTableHeight, available - 160))));

export function QqqTerminalWorkspace({ header, headerRight, showFocusButton = true, main, aside, left, footer, bottom, variant, layoutStorageKey = defaultLayoutStorageKey, asideLabel = '设置与监控', focusLabel = '专注图表' }: { variant?: 'analysis'; layoutStorageKey?: string; asideLabel?: string; focusLabel?: string; header?: ReactNode; headerRight?: ReactNode; showFocusButton?: boolean; main: ReactNode; aside: ReactNode; left?: ReactNode; footer?: ReactNode; bottom?: ReactNode }) {
  const hasHeader=header!=null||headerRight!=null||showFocusButton;
  const workspaceRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<{ asideCollapsed: boolean; leftCollapsed: boolean; bottomHeight: number | null; leftWidth?: number; rightWidth?: number }>({ asideCollapsed: false, leftCollapsed: false, bottomHeight: null });
  const widthDrag = useRef<{ side: 'left' | 'right'; x: number; width: number; available: number; previous?: number } | null>(null);
  const [widthFrame] = useState(() => createQqqLayoutFrame());
  const [heightFrame] = useState(() => createQqqLayoutFrame());
  const beforeFocus = useRef<{left: boolean; right: boolean} | null>(null);
  const applyWidth = (side: 'left' | 'right', width: number, available = bodyRef.current?.clientWidth ?? window.innerWidth) => {
    const value = Math.round(Math.max(200, Math.min(width, Math.max(200, (available - 320) / 2))));
    layoutRef.current[side === 'left' ? 'leftWidth' : 'rightWidth'] = value;
    const style = bodyRef.current?.style;
    if (style?.getPropertyValue(`--qqq-${side}-size`) !== `${value}px`) style?.setProperty(`--qqq-${side}-size`, `${value}px`);
  };
  const finishWidthDrag = () => {
    if (!widthDrag.current) return;
    widthFrame.flush();
    widthDrag.current = null;
    persist();
  };
  const widthHandle = (side: 'left' | 'right') => <div className={`${styles.widthDivider} ${side === 'left' ? styles.widthLeft : styles.widthRight}`} role="separator" aria-label={`调整${side === 'left' ? '左' : '右'}侧面板宽度`} aria-orientation="vertical" tabIndex={0}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); widthDrag.current = { side, x: event.clientX, width: event.currentTarget.parentElement?.clientWidth ?? 280, available: bodyRef.current?.clientWidth ?? window.innerWidth, previous: layoutRef.current[side === 'left' ? 'leftWidth' : 'rightWidth'] }; }}
    onPointerMove={event => { const drag = widthDrag.current; if (drag?.side === side) { const width = drag.width + (event.clientX - drag.x) * (side === 'left' ? 1 : -1); widthFrame.schedule(() => applyWidth(side, width, drag.available)); } }}
    onPointerUp={event => { finishWidthDrag(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => {
      const drag = widthDrag.current;
      if (!drag) return;
      widthFrame.cancel();
      widthDrag.current = null;
      layoutRef.current[side === 'left' ? 'leftWidth' : 'rightWidth'] = drag.previous;
      if (drag.previous === undefined) bodyRef.current?.style.removeProperty(`--qqq-${side}-size`);
      else applyWidth(side, drag.previous, drag.available);
    }}
    onLostPointerCapture={finishWidthDrag}
    onKeyDown={event => { if (!['ArrowLeft','ArrowRight'].includes(event.key)) return; event.preventDefault(); const width = event.currentTarget.parentElement?.clientWidth ?? 280; applyWidth(side, width + (event.key === 'ArrowRight' ? 20 : -20) * (side === 'left' ? 1 : -1)); persist(); }} />;
  const dragRef = useRef<{ y: number; height: number; available: number; previous: number | null } | null>(null);
  const [asideCollapsed, setAsideCollapsed] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const leftId = useId();
  const asideId = useId();
  const availableHeight = () => (bodyRef.current?.getBoundingClientRect().height ?? 0) + (bottomRef.current?.getBoundingClientRect().height ?? 0);
  const setTableHeight = (height: number | null, available = availableHeight()) => {
    if (height === null) {
      workspaceRef.current?.style.removeProperty('--qqq-bottom-size');
      dividerRef.current?.setAttribute('aria-valuenow', String(Math.round(bottomRef.current?.getBoundingClientRect().height ?? minTableHeight)));
    } else {
      const visibleHeight = clampTableHeight(height, available);
      const style = workspaceRef.current?.style;
      if (style?.getPropertyValue('--qqq-bottom-size') !== `${visibleHeight}px`) style?.setProperty('--qqq-bottom-size', `${visibleHeight}px`);
      dividerRef.current?.setAttribute('aria-valuenow', String(visibleHeight));
    }
  };
  const persist = () => {
    try { window.localStorage.setItem(layoutStorageKey, JSON.stringify(layoutRef.current)); } catch { /* Layout remains usable when storage is disabled. */ }
  };
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(layoutStorageKey) ?? 'null');
      if (saved && typeof saved === 'object') {
        layoutRef.current = { asideCollapsed: saved.asideCollapsed === true, leftCollapsed: saved.leftCollapsed === true,
          leftWidth: saved.leftWidth, rightWidth: saved.rightWidth, bottomHeight: typeof saved.bottomHeight === 'number' && Number.isFinite(saved.bottomHeight) && saved.bottomHeight >= minTableHeight ? saved.bottomHeight : null };
        setAsideCollapsed(layoutRef.current.asideCollapsed);
        setLeftCollapsed(layoutRef.current.leftCollapsed);
        if (Number.isFinite(saved.leftWidth)) applyWidth('left', saved.leftWidth);
        if (Number.isFinite(saved.rightWidth)) applyWidth('right', saved.rightWidth);
      } else if (window.innerWidth < 1400) { layoutRef.current.leftCollapsed = true; setLeftCollapsed(true); }
    } catch { /* Ignore invalid or unavailable preferences. */ }
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const resizeFrame = createQqqLayoutFrame();
    const update = () => {
      if (!bottomRef.current || dragRef.current || widthDrag.current) return;
      // Read geometry together, then write. Avoid a forced layout after the CSS update.
      const bottomHeight = bottomRef.current?.getBoundingClientRect().height ?? 0;
      const available = (bodyRef.current?.getBoundingClientRect().height ?? 0) + bottomHeight;
      const height = layoutRef.current.bottomHeight;
      const visibleHeight = height === null ? bottomHeight || minTableHeight : clampTableHeight(height, available);
      if (height !== null && workspace.style.getPropertyValue('--qqq-bottom-size') !== `${visibleHeight}px`) workspace.style.setProperty('--qqq-bottom-size', `${visibleHeight}px`);
      dividerRef.current?.setAttribute('aria-valuenow', String(Math.round(visibleHeight)));
      dividerRef.current?.setAttribute('aria-valuemax', String(Math.max(minTableHeight, Math.round(available - 160))));
    };
    update();
    const observer = new ResizeObserver(() => resizeFrame.schedule(update));
    if (bottomRef.current) observer.observe(workspace);
    return () => { observer.disconnect(); resizeFrame.cancel(); widthFrame.cancel(); heightFrame.cancel(); };
  }, [layoutStorageKey, widthFrame, heightFrame]);
  const toggleAside = () => {
    const collapsed = !asideCollapsed;
    layoutRef.current.asideCollapsed = collapsed;
    setAsideCollapsed(collapsed);
    persist();
  };
  return <main ref={workspaceRef} className={`${styles.workspace} ${bottom ? styles.withBottom : ''} ${hasHeader ? '' : styles.withoutHeader} ${variant === 'analysis' ? styles.analysis : ''}`} aria-label="QQQ 操作终端">
    {hasHeader&&<header className={styles.header}><div style={{ flex: 1, minWidth: 0 }}>{header}</div>{showFocusButton && <button className={styles.focusButton} type="button" aria-pressed={asideCollapsed && (!left || leftCollapsed)} onClick={() => {
      const focused = asideCollapsed && (!left || leftCollapsed);
      if (!focused) beforeFocus.current = { left: leftCollapsed, right: asideCollapsed };
      const next = focused ? beforeFocus.current ?? { left: false, right: false } : { left: true, right: true };
      layoutRef.current.leftCollapsed = next.left; layoutRef.current.asideCollapsed = next.right;
      setLeftCollapsed(next.left); setAsideCollapsed(next.right); persist();
    }}>{asideCollapsed && (!left || leftCollapsed) ? '恢复面板' : focusLabel}</button>}{headerRight && <div className={styles.headerRight}>{headerRight}</div>}</header>}
    <div ref={bodyRef} className={`${styles.body} ${asideCollapsed ? styles.asideCollapsed : ''} ${left ? styles.withLeft : ''} ${left && leftCollapsed ? styles.leftCollapsed : ''}`}>
      {left && <aside className={`${styles.aside} ${styles.asideShell} ${styles.leftShell}`} aria-label="左侧数据观察区">{!leftCollapsed && widthHandle('left')}
        <button className={styles.asideToggle} type="button" onClick={() => { layoutRef.current.leftCollapsed = !leftCollapsed; setLeftCollapsed(!leftCollapsed); persist(); }} aria-label={leftCollapsed ? '展开数据观察区' : '收起数据观察区'} aria-expanded={!leftCollapsed} aria-controls={leftId} title={leftCollapsed ? '展开数据观察区' : '收起到左侧'}>{leftCollapsed ? '›' : '‹'}</button>
        {leftCollapsed && <button className={styles.asideRail} type="button" onClick={() => { layoutRef.current.leftCollapsed = false; setLeftCollapsed(false); persist(); }} aria-label="展开数据观察区">数据观察</button>}
        <div id={leftId} className={styles.asideContent} hidden={leftCollapsed}><TabVisible.Provider value={!leftCollapsed}><RetainedTabContent visible={!leftCollapsed}>{left}</RetainedTabContent></TabVisible.Provider></div>
      </aside>}
      <div className={styles.main}>{main}</div>
      <aside className={`${styles.aside} ${styles.asideShell}`} aria-label={`右侧${asideLabel}区`}>{!asideCollapsed && widthHandle('right')}
        <button className={styles.asideToggle} type="button" onClick={toggleAside} aria-label={asideCollapsed ? `展开${asideLabel}区` : `收起${asideLabel}区`} aria-expanded={!asideCollapsed} aria-controls={asideId} title={asideCollapsed ? `展开${asideLabel}区` : '收起到右侧'}>{asideCollapsed ? '‹' : '›'}</button>
        {asideCollapsed && <button className={styles.asideRail} type="button" onClick={toggleAside} aria-label={`展开${asideLabel}区`}>{asideLabel}</button>}
        <div id={asideId} className={styles.asideContent} hidden={asideCollapsed}><TabVisible.Provider value={!asideCollapsed}><RetainedTabContent visible={!asideCollapsed}>{aside}</RetainedTabContent></TabVisible.Provider></div>
      </aside>
    </div>
    {bottom && <>
      <div ref={dividerRef} className={styles.divider} role="separator" aria-label="调整快照表高度" aria-orientation="horizontal" aria-valuemin={minTableHeight} tabIndex={0} title="上下拖动调整表格高度；双击恢复默认"
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { y: event.clientY, height: bottomRef.current?.getBoundingClientRect().height ?? minTableHeight, available: availableHeight(), previous: layoutRef.current.bottomHeight };
        }}
        onPointerMove={event => {
          const drag = dragRef.current;
          if (!drag) return;
          const height = clampTableHeight(drag.height + drag.y - event.clientY, drag.available);
          heightFrame.schedule(() => { layoutRef.current.bottomHeight = height; setTableHeight(height, drag.available); });
        }}
        onPointerUp={event => {
          if (!dragRef.current) return;
          heightFrame.flush();
          dragRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          persist();
        }}
        onPointerCancel={() => {
          if (!dragRef.current) return;
          const previous = dragRef.current.previous;
          heightFrame.cancel();
          dragRef.current = null;
          layoutRef.current.bottomHeight = previous;
          setTableHeight(previous);
        }}
        onLostPointerCapture={() => {
          if (!dragRef.current) return;
          heightFrame.flush();
          dragRef.current = null;
          persist();
        }}
        onDoubleClick={() => { layoutRef.current.bottomHeight = null; setTableHeight(null); persist(); }}
        onKeyDown={event => {
          const height = bottomRef.current?.getBoundingClientRect().height ?? minTableHeight;
          const next = event.key === 'ArrowUp' ? height + 24 : event.key === 'ArrowDown' ? height - 24 : event.key === 'Home' ? minTableHeight : event.key === 'End' ? availableHeight() - 160 : null;
          if (next === null) return;
          event.preventDefault();
          layoutRef.current.bottomHeight = clampTableHeight(next, availableHeight());
          setTableHeight(layoutRef.current.bottomHeight);
          persist();
        }} />
      <section ref={bottomRef} className={styles.bottom} aria-label="GEX 快照表">{bottom}</section>
    </>}
    {footer && <footer className={styles.footer}>{footer}</footer>}
  </main>;
}

export function QqqTerminalPanel({ title, label, children, id, fill = false, info }: { title: ReactNode; label?: string; info?: ReactNode; children: ReactNode; id?: string; fill?: boolean }) {
  return <section id={id} className={`${styles.panel} ${fill ? styles.fill : ''}`} aria-label={label??(typeof title==='string'?title:undefined)}><h2 className={styles.title}>{title}{info}</h2><div className={styles.content}>{children}</div></section>;
}

const TabVisible = createContext(true);
export const useQqqTerminalTabVisible = () => useContext(TabVisible);
const RetainedTabContent = memo(function RetainedTabContent({visible,children}:{visible:boolean;children:ReactNode}) {
  return <>{children}</>;
},(previous,next)=>!previous.visible&&!next.visible);

/** Portal targets belong to visible tabs; hidden hosts must not keep rendering
 * their chart into an invisible sidebar after the tab has been visited. */
export function QqqTerminalPortalHost({onTarget,style}:{onTarget?: (node:HTMLDivElement|null)=>void;style?:CSSProperties}) {
  const ref=useRef<HTMLDivElement>(null),visible=useQqqTerminalTabVisible();
  useEffect(()=>{onTarget?.(visible?ref.current:null);return()=>onTarget?.(null);},[onTarget,visible]);
  return <div ref={ref} style={style}/>;
}

export function QqqTerminalTabs({ items, label = "历史与研究", onTabChange, lazy = false, storageKey, activateOnEvent, activeLabel }: { activeLabel?: string; lazy?: boolean; onTabChange?: (label:string)=>void; label?: string; storageKey?: string; activateOnEvent?: string; items: { label: string; content: ReactNode; tooltip?: { label: string; content: ReactNode } }[] }) {
  const parentVisible=useQqqTerminalTabVisible();
  const [selected, setActive] = useState(0);
  const active = activeLabel === undefined ? selected : Math.max(0, items.findIndex(item => item.label === activeLabel));
  const [visited, setVisited] = useState(() => new Set([0]));
  const itemsRef = useRef(items);
  const onTabChangeRef = useRef(onTabChange);
  itemsRef.current = items;
  onTabChangeRef.current = onTabChange;
  const select = (index: number) => {
    setActive(index);
    setVisited(current => current.has(index) ? current : new Set([...current, index]));
    onTabChange?.(items[index]!.label);
    if (storageKey) try { window.localStorage.setItem(storageKey, qqqTerminalTabStorageValue(items[index]!.label)); } catch { /* Keep the selection in memory when storage is unavailable. */ }
  };
  const id = useId();
  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = window.localStorage.getItem(storageKey);
      const index = resolveQqqTerminalTabIndex(itemsRef.current.map(item => item.label), saved);
      if (index !== 0) {
        setActive(index);
        setVisited(current => current.has(index) ? current : new Set([...current, index]));
        onTabChangeRef.current?.(itemsRef.current[index]!.label);
      }
    } catch { /* Invalid or unavailable preferences leave the default tab selected. */ }
  }, [storageKey]);
  useEffect(()=>{
    if(!activateOnEvent) return;
    const open=()=>{
      const currentItems = itemsRef.current;
      const index = qqqTerminalTabEventIndex(currentItems.map(item => item.label));
      if (index === null) return;
      const first = currentItems[index]!;
      setActive(index);
      setVisited(current => current.has(index) ? current : new Set([...current, index]));
      onTabChangeRef.current?.(first.label);
      if (storageKey) try { window.localStorage.setItem(storageKey, qqqTerminalTabStorageValue(first.label)); } catch { /* Keep the selection in memory. */ }
    };
    window.addEventListener(activateOnEvent,open);
    return()=>window.removeEventListener(activateOnEvent,open);
  },[activateOnEvent,storageKey]);
  return <section className={`${styles.panel} ${styles.fill}`} aria-label={label}>
    <div className={styles.tabs} role="tablist" aria-label={label}>{items.map((item, index) => {
      const tabButton = <button key={item.label} type="button" id={`${id}-tab-${index}`} role="tab" aria-selected={active === index} aria-controls={`${id}-panel-${index}`} aria-description={item.tooltip?.label} tabIndex={active === index ? 0 : -1} onKeyDown={(event) => {
      const next = event.key === 'ArrowRight' ? (index + 1) % items.length : event.key === 'ArrowLeft' ? (index + items.length - 1) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null;
      if (next === null) return;
      event.preventDefault();
      select(next);
      (event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
      }} onClick={() => select(index)}>{item.label}{item.tooltip && <span aria-hidden="true" style={{ fontSize: '.72em', marginLeft: 5, opacity: 0.75 }}>ⓘ</span>}</button>;
      if (!item.tooltip) return tabButton;
      return <Tooltip.Root key={item.label}>
        <Tooltip.Trigger render={tabButton} />
        <Tooltip.Portal>
          <Tooltip.Positioner className="ui-tooltip-positioner" sideOffset={8}>
            <Tooltip.Popup role="tooltip" className="ui-tooltip" style={{ maxWidth: 360 }}>{item.tooltip.content}</Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>;
    })}</div>
    {items.map((item, index) => <div key={item.label} role="tabpanel" aria-labelledby={`${id}-tab-${index}`} id={`${id}-panel-${index}`} hidden={active !== index} className={styles.tabContent}>{!lazy || active === index || visited.has(index) ? <TabVisible.Provider value={parentVisible&&active===index}><RetainedTabContent visible={parentVisible&&active===index}>{item.content}</RetainedTabContent></TabVisible.Provider> : null}</div>)}
  </section>;
}
