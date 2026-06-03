/**
 * OpenVox GUI - StatusBadge.tsx
 * 
 * Component documentation to be expanded.
 */
import { Badge } from '@mantine/core';

const STATUS_COLORS: Record<string, string> = {
  changed: 'yellow',
  unchanged: 'green',
  failed: 'red',
  unreported: 'gray',
  noop: 'blue',
  active: 'green',
  inactive: 'red',
  unknown: 'gray',
};

interface StatusBadgeProps {
  status: string | null | undefined;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

export function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const s = (status || '').toString().toLowerCase() || 'unreported';
  const label = s === 'unreported' || s === 'unknown' ? 'unreported' : s;
  return (
    <Badge color={STATUS_COLORS[label] || STATUS_COLORS['unknown'] || 'gray'} variant="filled" size={size}>
      {label}
    </Badge>
  );
}
