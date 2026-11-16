'use client';

import * as React from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { cn } from '@/lib/utils';

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverPortal = PopoverPrimitive.Portal;

const PopoverContent = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Popup> & { positionerClassName?: string }>(
  ({ className, positionerClassName, ...props }, ref) => (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner sideOffset={8} className={positionerClassName}>
        <PopoverPrimitive.Popup ref={ref} className={cn('ui-popover', className)} {...props} />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  ),
);
PopoverContent.displayName = 'PopoverContent';

const PopoverTitle = PopoverPrimitive.Title;
const PopoverDescription = PopoverPrimitive.Description;
const PopoverClose = PopoverPrimitive.Close;

export { Popover, PopoverClose, PopoverContent, PopoverDescription, PopoverPortal, PopoverTitle, PopoverTrigger };
