/**
 * Shared chart theme and utilities for high-quality recharts rendering.
 *
 * All charts in openvox-gui should import from here for consistent
 * styling across Dashboard, Metrics, and any future chart pages.
 */

// High-contrast color palette optimized for both light and dark themes
export const CHART_COLORS = {
  primary: '#0D6EFD',
  success: '#2ecc71',
  warning: '#f39c12',
  danger: '#e74c3c',
  info: '#3498db',
  muted: '#95a5a6',
  purple: '#9b59b6',
  orange: '#e67e22',
  teal: '#1abc9c',
  pink: '#e91e63',
};

// Ordered palette for categorical data (pie charts, bar series, etc.)
export const PALETTE = [
  '#0D6EFD', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6',
  '#1abc9c', '#e67e22', '#3498db', '#e91e63', '#95a5a6',
  '#2c3e50', '#27ae60', '#c0392b', '#d35400', '#8e44ad',
];

// Status-specific colors matching Puppet report statuses
export const STATUS_COLORS = {
  unchanged: '#2ecc71',
  changed: '#f39c12',
  failed: '#e74c3c',
  noop: '#3498db',
  unreported: '#95a5a6',
  compliant: '#2ecc71',
  drifted: '#e67e22',
};

// Shared axis/grid styling for crisp rendering
export const AXIS_STYLE = {
  fontSize: 11,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fill: '#8899aa',
};

export const GRID_STYLE = {
  strokeDasharray: '3 3',
  stroke: '#e0e0e0',
  strokeOpacity: 0.5,
};

// Tooltip styling
export const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'rgba(20, 20, 33, 0.95)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
    padding: '10px 14px',
    fontSize: 12,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#e0e0e0',
  },
  itemStyle: {
    fontSize: 12,
    padding: '2px 0',
  },
  labelStyle: {
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 4,
    color: '#ffffff',
  },
};

// Standard chart heights
export const CHART_HEIGHT = {
  small: 250,
  medium: 350,
  large: 420,
  hero: 500,
};

// Gradient definitions for area charts — use as SVG <defs> children
export function GradientDef({ id, color, opacity = 0.3 }: { id: string; color: string; opacity?: number }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={opacity} />
      <stop offset="95%" stopColor={color} stopOpacity={0.02} />
    </linearGradient>
  );
}

// Format large numbers
export function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

// Format seconds to human-readable
export function formatDuration(seconds: number): string {
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

// Format timestamp for axis labels
export function formatAxisTimestamp(ts: string): string {
  if (!ts) return '';
  // If it's an ISO string, extract time portion
  const timePart = ts.includes('T') ? ts.split('T')[1]?.substring(0, 5) : ts.substring(11, 16);
  return timePart || ts.substring(0, 10);
}
