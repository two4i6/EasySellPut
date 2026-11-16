'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<'select'>>(
  ({ className, ...props }, ref) => <select ref={ref} className={cn('ui-select w-full min-h-10 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-60', className)} {...props} />,
);
NativeSelect.displayName = 'NativeSelect';

const Select = NativeSelect;

export { NativeSelect, Select };
