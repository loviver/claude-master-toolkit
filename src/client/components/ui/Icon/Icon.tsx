import { forwardRef } from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import styles from './Icon.module.css';

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_MAP: Record<Size, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
};

export interface IconProps extends Omit<LucideProps, 'size'> {
  icon: LucideIcon;
  size?: Size | number;
  tone?: 'default' | 'muted' | 'claude' | 'blue' | 'green' | 'red' | 'amber' | 'cyan' | 'purple';
}

export const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
  { icon: IconCmp, size = 'md', tone = 'default', className, ...rest },
  ref,
) {
  const numericSize = typeof size === 'number' ? size : SIZE_MAP[size];
  return (
    <IconCmp
      ref={ref}
      size={numericSize}
      strokeWidth={1.75}
      className={`${styles.icon} ${styles[tone]} ${className ?? ''}`}
      aria-hidden="true"
      {...rest}
    />
  );
});
