'use client';

import { useState, type ReactNode } from 'react';
import { Tooltip } from '@base-ui/react/tooltip';
import styles from './QqqInfoTooltip.module.css';

export default function QqqInfoTooltip({ label, content, children }: { label: string; content: ReactNode; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Tooltip.Root open={open} onOpenChange={setOpen}><Tooltip.Trigger type="button" data-info-tooltip className={styles.trigger} onClick={() => setOpen(true)} aria-label={label}>{children ?? <span aria-hidden="true">ⓘ</span>}</Tooltip.Trigger><Tooltip.Portal><Tooltip.Positioner className="ui-tooltip-positioner" sideOffset={8}><Tooltip.Popup role="tooltip" className={`ui-tooltip ${styles.popup}`} style={{ maxWidth: 360 }}>{content}</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal></Tooltip.Root>;
}
