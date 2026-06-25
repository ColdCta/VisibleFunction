import type { ReactNode } from 'react';
import styles from './Badge.module.css';

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'accent' | 'muted' | 'command' | 'event' | 'function';
  title?: string;
}

const VARIANT_CLASS: Record<NonNullable<BadgeProps['variant']>, string> = {
  default: styles.default,
  accent: styles.accent,
  muted: styles.muted,
  command: styles.command,
  event: styles.event,
  function: styles.function,
};

export function Badge({ children, variant = 'default', title }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${VARIANT_CLASS[variant]}`} title={title}>
      {children}
    </span>
  );
}
