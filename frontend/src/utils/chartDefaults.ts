/**
 * Shared Recharts defaults for OpenVox GUI performance.
 *
 * Recharts animates every series on mount/update by default. On pages that
 * render many Area/Line charts (Run Performance, Server/DB health, Monitoring
 * wallboard) that costs tens of ms of main-thread work *per chart* and is the
 * main reason graphs feel "laggy" after data arrives.
 *
 * Spread CHART_SERIES_PROPS onto Area / Line / Bar / Pie:
 *   <Area type="monotone" dataKey="x" {...CHART_SERIES_PROPS} />
 *
 * Prefer keeping animations off for operational dashboards; tooltips still work.
 */

/** Disable enter/update animations on series components. */
export const CHART_SERIES_PROPS = {
  isAnimationActive: false,
  animationDuration: 0,
} as const;

/** Safer default for dense live series — cap points before bind to Recharts. */
export const MAX_CHART_POINTS = 180;

/**
 * Downsample an ordered time series to at most *max* points (keep first/last,
 * stride the middle). Cheap and preserves trend shape for wallboard charts.
 */
export function downsampleSeries<T>(points: T[] | null | undefined, max = MAX_CHART_POINTS): T[] {
  if (!points || points.length === 0) return [];
  if (points.length <= max) return points;
  const out: T[] = [];
  const last = points.length - 1;
  const step = last / (max - 1);
  for (let i = 0; i < max; i++) {
    out.push(points[Math.round(i * step)]);
  }
  return out;
}
