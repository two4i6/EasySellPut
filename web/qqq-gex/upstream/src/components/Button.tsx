'use client';

import React from 'react';
import { Button as ShadcnButton } from './ui/button';

interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  children?: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'magi' | 'danger' | 'success';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  active?: boolean;
  width?: string | number;
  loading?: boolean;
}

const Button: React.FC<ButtonProps> = ({
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  icon,
  active = false,
  style: customStyle,
  className = '',
  title,
  type = 'button',
  disabled = false,
  width,
  loading = false,
  ...rest
}) => {
  const getVariantClass = () => {
    switch (variant) {
      case 'primary': return 'btn-primary';
      case 'secondary': return 'btn-secondary';
      case 'outline': return 'btn-outline'; // We can add this to CSS if missing
      case 'ghost': return 'btn-ghost';
      case 'magi': return 'btn-magi';
      case 'danger': return 'btn-danger';
      case 'success': return 'btn-success';
      default: return '';
    }
  };

  const sizeClass = size === 'xs' ? 'px-2 py-1 text-[0.65rem] h-7 min-w-0' : size === 'sm' ? 'px-3.5 py-2 text-xs h-8' : size === 'lg' ? 'px-6 py-4 text-base h-[3.25rem]' : 'px-5 py-3 text-sm h-[2.625rem]';
  const stateClass = disabled || loading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer';

  return (
    <ShadcnButton
      {...rest}
      type={type}
      onClick={onClick}
      title={title}
      disabled={disabled || loading}
      variant={variant === 'primary' ? 'primary' : variant === 'danger' ? 'danger' : variant === 'success' ? 'success' : variant === 'ghost' ? 'ghost' : variant === 'outline' ? 'outline' : variant === 'magi' ? 'magi' : 'secondary'}
      size={size === 'md' ? 'default' : size}
      loading={loading}
      className={`btn ${sizeClass} ${stateClass} ${getVariantClass()} ${active ? 'active' : ''} ${loading ? 'loading' : ''} ${width ? 'w-full' : ''} ${className}`}
      style={customStyle}
    >
      {icon && !loading && (
        <span className="flex items-center gap-[inherit]">
          {icon}
        </span>
      )}
      {children}
    </ShadcnButton>
  );
};

export default Button;
