'use client';

import React from 'react';
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: string;
  borderColor?: string;
  style?: React.CSSProperties;
}

export function Tooltip({ content, children, maxWidth = '260px', borderColor = 'var(--border-color)', style }: TooltipProps) {
  if (!content) return <>{children}</>;

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={<span style={{ display: 'inline-flex', cursor: 'help', ...style }} />}>
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner className="ui-tooltip-positioner" sideOffset={8}>
          <TooltipPrimitive.Popup className="ui-tooltip" style={{ maxWidth, borderColor }}>
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export default Tooltip;
