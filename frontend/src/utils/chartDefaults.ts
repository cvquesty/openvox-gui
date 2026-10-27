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

/** Linear interpolation — natural/monotone cubics overshoot noisy ops series. */
export const CHART_LINE_TYPE = 'linear' as const;

/**
 * Jolokia/Dropwizard timer Mean is ns, µs, or ms depending on the bean.
 * Pick the unit from magnitude so Y values are real milliseconds.
 */
export function jmxTimerToMs(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // ≥ 1e6 is nanoseconds (1ms). Smaller values are already milliseconds
  // (including sub-ms). Do not treat 15_000 as µs — that is a 15s mean.
  if (n >= 1e6) return n / 1e6;
  return n;
}

/** Jolokia timer/gauge: bare number, {Mean}, {Value}, or an error object. */
export function jmxMean(obj: unknown): number {
  if (obj == null || typeof obj === 'boolean') return 0;
  if (typeof obj === 'number') return jmxTimerToMs(obj);
  if (typeof obj !== 'object') return jmxTimerToMs(obj);
  const o = obj as Record<string, unknown>;
  if (o.error && o.Mean == null && o.mean == null && o.Value == null) return 0;
  return jmxTimerToMs(o.Mean ?? o.mean ?? o.Value ?? o.value);
}

/** Duplicate-pct and similar gauges: 0–1 ratio or already 0–100. */
export function jmxGaugePct(obj: unknown): number {
  let n: number;
  if (typeof obj === 'number') n = obj;
  else if (obj && typeof obj === 'object') {
    const o = obj as Record<string, unknown>;
    n = Number(o.Value ?? o.value ?? o.Mean);
  } else {
    n = Number(obj);
  }
  if (!Number.isFinite(n) || n < 0) return 0;
  return n <= 1 ? n * 100 : n;
}

/** Props ChartPanel cloneElement injects; DurationOverlay must forward these. */
export function chartSizeProps(width?: number, height?: number): { width?: number; height?: number } {
  const out: { width?: number; height?: number } = {};
  if (typeof width === 'number' && width > 0) out.width = width;
  if (typeof height === 'number' && height > 0) out.height = height;
  return out;
}

/** Never print 0.00ms for a non-zero duration. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms === 0) return '0';
  const a = Math.abs(ms);
  if (a >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (a >= 10) return `${ms.toFixed(1)}ms`;
  if (a >= 1) return `${ms.toFixed(2)}ms`;
  if (a >= 0.01) return `${ms.toFixed(2)}ms`;
  if (a >= 0.001) return `${(ms * 1000).toFixed(1)}µs`;
  return `${(ms * 1000).toFixed(2)}µs`;
}

export function durationTickFormatter(maxMs: number): (v: number) => string {
  const max = Math.max(0, maxMs);
  if (max >= 1000) return (v) => `${(v / 1000).toFixed(1)}s`;
  if (max >= 10) return (v) => `${v.toFixed(0)}ms`;
  if (max >= 1) return (v) => `${v.toFixed(1)}ms`;
  if (max >= 0.01) return (v) => `${v.toFixed(2)}ms`;
  return (v) => `${(v * 1000).toFixed(0)}µs`;
}

export function seriesMaxes(
  rows: Array<Record<string, unknown>> | null | undefined,
  keys: string[],
): Record<string, number> {
  const maxes: Record<string, number> = {};
  for (const k of keys) maxes[k] = 0;
  if (!rows?.length) return maxes;
  for (const row of rows) {
    for (const k of keys) {
      const v = Number(row[k]);
      if (Number.isFinite(v) && v > maxes[k]) maxes[k] = v;
    }
  }
  return maxes;
}

/** Overlay series whose peaks differ by more than this factor get 0–100% scaling. */
export const DURATION_NORMALIZE_RATIO = 8;

export function shouldNormalizeDurations(maxes: Record<string, number>): boolean {
  const peaks = Object.values(maxes).filter((v) => v > 0);
  if (peaks.length < 2) return false;
  return Math.max(...peaks) / Math.min(...peaks) > DURATION_NORMALIZE_RATIO;
}

export type DurationOverlay = {
  rows: Array<Record<string, unknown>>;
  maxes: Record<string, number>;
  normalized: boolean;
};

/**
 * Attach __raw ms and optionally scale each key to 0–100 of its own max
 * so a µs facts line is visible next to a ms report line.
 */
export function prepareDurationOverlay(
  rows: Array<Record<string, unknown>> | null | undefined,
  keys: string[],
): DurationOverlay {
  const maxes = seriesMaxes(rows, keys);
  const normalized = shouldNormalizeDurations(maxes);
  if (!rows?.length) return { rows: [], maxes, normalized };
  const out = rows.map((row) => {
    const next: Record<string, unknown> = { ...row };
    for (const k of keys) {
      const v = Number(row[k]);
      const raw = Number.isFinite(v) ? v : 0;
      next[`${k}__raw`] = raw;
      if (normalized) {
        const m = maxes[k];
        next[k] = m > 0 ? (raw / m) * 100 : 0;
      }
    }
    return next;
  });
  return { rows: out, maxes, normalized };
}

/**
 * Recharts 2 treats a string dataKey as a lodash path (`a.b` → obj.a.b).
 * Production certnames are FQDNs, so they must not be used as dataKeys.
 */
export function safeChartKey(id: string): string {
  return `k_${String(id).replace(/[^A-Za-z0-9]+/g, '_')}`;
}

export type TimedNodeRun = {
  time?: string;
  certname?: string;
  total?: number;
  run_duration?: number;
};

function runSeconds(run: TimedNodeRun): number | null {
  const total = Number(run.total);
  if (Number.isFinite(total) && total > 0) return total;
  const dur = Number(run.run_duration);
  if (Number.isFinite(dur) && dur > 0) return dur;
  if (Number.isFinite(total)) return total;
  return null;
}

/**
 * Hourly averages keyed by safeChartKey(certname).
 * Only hours that contain at least one requested node are emitted.
 * Padding every fleet hour (previous behavior) leaves production
 * charts as a long all-null X axis — hover then shows no tooltip.
 */
export function buildHourlyNodeSeries(
  runs: TimedNodeRun[] | null | undefined,
  certnames: string[],
): Array<Record<string, string | number | null>> {
  if (!runs?.length || !certnames.length) return [];
  const keys = certnames.map(safeChartKey);
  const nameToKey = new Map(certnames.map((n, i) => [n, keys[i]]));
  const hours = new Set<string>();
  const buckets: Record<string, Record<string, number[]>> = {};
  for (const run of runs) {
    const hour = String(run.time ?? '').substring(0, 13);
    if (!hour) continue;
    const key = nameToKey.get(run.certname || '');
    if (!key) continue;
    const v = runSeconds(run);
    if (v == null) continue;
    hours.add(hour);
    if (!buckets[hour]) buckets[hour] = {};
    if (!buckets[hour][key]) buckets[hour][key] = [];
    buckets[hour][key].push(v);
  }
  return [...hours].sort().map((hour) => {
    const point: Record<string, string | number | null> = { time: hour };
    for (const key of keys) {
      const vals = buckets[hour]?.[key];
      point[key] = vals?.length
        ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2))
        : null;
    }
    return point;
  });
}

const TIME_KEYS = new Set([
  'time', 'timestamp', 'ts', 'hour', 'label', 'name', 'certname',
]);

/** Window length that tracks trend without washing out a short series. */
export function defaultMaWindow(n: number): number {
  if (n < 4) return 1;
  if (n < 12) return 3;
  if (n < 40) return 5;
  if (n < 120) return 7;
  return 11;
}

/**
 * Trailing simple moving average over *keys*.
 * Non-finite values are skipped in the window. Labels/time fields are copied through.
 */
export function movingAverageSeries<T extends Record<string, unknown>>(
  points: T[] | null | undefined,
  keys: string[],
  window?: number,
): T[] {
  if (!points || points.length === 0) return [];
  if (!keys.length) return points;
  const w = Math.max(1, window ?? defaultMaWindow(points.length));
  if (w === 1 || points.length < 2) return points;

  return points.map((row, i) => {
    const start = Math.max(0, i - w + 1);
    const next: Record<string, unknown> = { ...row };
    for (const key of keys) {
      let sum = 0;
      let count = 0;
      for (let j = start; j <= i; j++) {
        const v = points[j][key];
        if (typeof v === 'number' && Number.isFinite(v)) {
          sum += v;
          count += 1;
        }
      }
      if (count > 0) next[key] = sum / count;
    }
    return next as T;
  });
}

/** Keep the newest *max* samples, one row per timestamp. */
export function mergeByTs<T extends { ts?: number }>(
  previous: T[] | null | undefined,
  incoming: T[] | null | undefined,
  max: number,
): T[] {
  const byTs = new Map<number, T>();
  for (const row of [...(previous || []), ...(incoming || [])]) {
    const ts = Number(row?.ts);
    if (!Number.isFinite(ts)) continue;
    byTs.set(ts, row);
  }
  return [...byTs.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-max)
    .map(([, row]) => row);
}

/**
 * SMA every numeric field except time/label keys. Use this before binding
 * live JMX / hourly trend rows to Recharts.
 */
export function smoothTimeSeries<T extends Record<string, unknown>>(
  points: T[] | null | undefined,
  window?: number,
): T[] {
  if (!points || points.length === 0) return [];
  const keys = new Set<string>();
  for (const row of points) {
    for (const [k, v] of Object.entries(row)) {
      if (TIME_KEYS.has(k)) continue;
      if (typeof v === 'number' && Number.isFinite(v)) keys.add(k);
    }
  }
  return movingAverageSeries(points, [...keys], window);
}
