'use client';

import { useRef, type ReactNode } from 'react';
import { useVirtualTableViewport } from '@/hooks/useVirtualTableViewport';
import { matrixRowWindow } from './qqqExposureRenderModel';

export default function QqqVirtualTableBody<T>({ rows, columns, renderRow }: { rows: readonly T[]; columns: number; renderRow: (row: T) => ReactNode }) {
  const ref = useRef<HTMLTableSectionElement>(null);
  const viewport = useVirtualTableViewport(ref, { initialHeight: 272, revision: rows.length, body: true, headerOffset: 48 });
  const window = matrixRowWindow(rows.length, viewport.top, viewport.height);
  const spacer = (height: number) => height > 0 && <tr aria-hidden="true"><td colSpan={columns} style={{ height, padding: 0, border: 0 }} /></tr>;
  return <tbody ref={ref}>{spacer(window.before)}{rows.slice(window.start, window.end).map(renderRow)}{spacer(window.after)}</tbody>;
}
