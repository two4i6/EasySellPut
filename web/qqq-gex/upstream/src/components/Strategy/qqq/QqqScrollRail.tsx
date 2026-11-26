'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import styles from './QqqScrollRail.module.css';

/** Native scrolling with overflow hints; observers stay local to this small rail. */
export default function QqqScrollRail({ children, label }: { children: ReactNode; label: string }) {
  const rail = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const node = rail.current;
    if (!node) return;
    const update = () => {
      const left = node.scrollLeft > 1;
      const right = node.scrollWidth - node.clientWidth - node.scrollLeft > 1;
      setEdges(previous => previous.left === left && previous.right === right ? previous : { left, right });
    };
    const observer = new ResizeObserver(update);
    observer.observe(node);
    if (content.current) observer.observe(content.current);
    node.addEventListener('scroll', update, { passive: true });
    update();
    return () => { observer.disconnect(); node.removeEventListener('scroll', update); };
  }, []);
  const move = (direction: number) => {
    const node = rail.current;
    if (node) node.scrollBy({ left: direction * Math.max(120, node.clientWidth * .65), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  return <div className={styles.wrapper}>
    <div ref={rail} className={styles.rail} aria-label={label} tabIndex={0}>
      <div ref={content} className={styles.content}>{children}</div>
    </div>
    {edges.left && <div className={`${styles.edge} ${styles.left}`}><button type="button" aria-label={`${label}：向左滚动`} onClick={() => move(-1)}><ChevronLeft size={14} /></button></div>}
    {edges.right && <div className={`${styles.edge} ${styles.right}`}><button type="button" aria-label={`${label}：向右滚动`} onClick={() => move(1)}><ChevronRight size={14} /></button></div>}
  </div>;
}
