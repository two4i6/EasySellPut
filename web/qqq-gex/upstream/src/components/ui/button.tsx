'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success' | 'magi' | 'link';
  size?: 'xs' | 'sm' | 'default' | 'lg' | 'icon';
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', loading = false, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn('ui-button', `ui-button-${variant}`, `ui-button-${size}`, className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="ui-button-spinner" size={14} aria-hidden="true" />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

export { Button };
