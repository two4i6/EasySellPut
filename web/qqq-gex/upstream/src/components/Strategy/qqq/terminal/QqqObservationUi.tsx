import type { ReactNode } from 'react';
import QqqInfoTooltip from '../QqqInfoTooltip';
import styles from './QqqObservationUi.module.css';

/** Shared presentation for the six observation destinations, including portals. */
export function QqqObservationPage({ children, description }: { children: ReactNode; description?: string }) {
  return <div className={styles.page} data-observation-page>{description&&<p className={styles.description}>{description}</p>}{children}</div>;
}

export function QqqObservationSection({ title, meta, info, value, children, className = '' }: {
  title: string; meta?: ReactNode; info?: ReactNode; value?: ReactNode; children: ReactNode; className?: string;
}) {
  return <section aria-label={title} className={`${styles.section} ${className}`}>
    <QqqObservationHeading title={title} meta={meta} info={info} value={value}/>{children}
  </section>;
}

export function QqqObservationHeading({ title, meta, info, value }: { title: string; meta?: ReactNode; info?: ReactNode; value?: ReactNode }) {
  return <div className={styles.heading}>
    <div className={styles.titleRow}><strong>{title}</strong>{value != null && <b className={styles.value}>{value}</b>}{info && <QqqInfoTooltip label={`${title}说明`} content={info}/>}</div>
    {meta && <div className={styles.meta}>{meta}</div>}
  </div>;
}

export function QqqObservationEmpty({ children }: { children: ReactNode }) {
  return <p role="status" className={styles.empty}>{children}</p>;
}

export function QqqObservationToolbar({ children }: { children: ReactNode }) {
  return <div className={styles.toolbar}>{children}</div>;
}
