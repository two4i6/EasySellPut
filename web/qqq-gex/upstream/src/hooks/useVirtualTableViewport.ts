'use client';
import { useEffect, useState, type RefObject } from 'react';

type Viewport = { top: number; height: number };

/** One observer and at most one update per animation frame; callers own offsets. */
export function observeVirtualTableViewport(element: HTMLElement, top: () => number, publish: (viewport: Viewport) => void) {
  let frame = 0;
  const update = () => { frame = 0; publish({ top: top(), height: element.clientHeight }); };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  const observer = new ResizeObserver(schedule);
  observer.observe(element);
  element.addEventListener('scroll', schedule, { passive: true });
  schedule();
  return () => { observer.disconnect(); element.removeEventListener('scroll', schedule); cancelAnimationFrame(frame); };
}

export function useVirtualTableViewport(ref: RefObject<HTMLElement | null>, options: {
  initialHeight: number; revision: unknown; body?: boolean; headerOffset?: number; resetScroll?: boolean;
}) {
  const { initialHeight, revision, body = false, headerOffset = 0, resetScroll = false } = options;
  const [viewport, setViewport] = useState<Viewport>({ top: 0, height: initialHeight });
  useEffect(() => {
    const node = ref.current;
    const scroll = body ? node?.parentElement?.parentElement : node;
    if (!node || !scroll) return;
    if (resetScroll) scroll.scrollTop = 0;
    return observeVirtualTableViewport(scroll, () => scroll.scrollTop + headerOffset - (body ? node.offsetTop : 0), next => {
      setViewport(previous => previous.top === next.top && previous.height === next.height ? previous : next);
    });
  }, [ref, revision, body, headerOffset, resetScroll]);
  return viewport;
}
