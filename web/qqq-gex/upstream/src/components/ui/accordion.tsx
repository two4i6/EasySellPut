import type { DetailsHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

export function Accordion({ children, ...props }: DetailsHTMLAttributes<HTMLDetailsElement>) { return <details className="ui-accordion" {...props}>{children}</details>; }
export function AccordionItem({ children, ...props }: DetailsHTMLAttributes<HTMLDetailsElement>) { return <details className="ui-accordion-item" {...props}>{children}</details>; }
export function AccordionTrigger({ children, ...props }: HTMLAttributes<HTMLElement> & { children?: ReactNode }) { return <summary className="ui-accordion-trigger" {...props}>{children}</summary>; }
export function AccordionContent({ children, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className="ui-accordion-content" {...props}>{children}</div>; }
