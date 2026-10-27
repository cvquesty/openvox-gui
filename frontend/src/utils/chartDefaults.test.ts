import { describe, it, expect } from 'vitest';
import {
  buildHourlyNodeSeries,
  chartSizeProps,
  defaultMaWindow,
  durationTickFormatter,
  formatDuration,
  jmxGaugePct,
  jmxMean,
  jmxTimerToMs,
  mergeByTs,
  movingAverageSeries,
  prepareDurationOverlay,
  safeChartKey,
  smoothTimeSeries,
} from './chartDefaults';

describe('mergeByTs', () => {
  it('keeps one row per timestamp and the newest max', () => {
    const merged = mergeByTs(
      [{ ts: 1, used: 1 }, { ts: 2, used: 2 }],
      [{ ts: 2, used: 9 }, { ts: 3, used: 3 }, { ts: 4, used: 4 }],
      3,
    );
    expect(merged.map((row) => row.ts)).toEqual([2, 3, 4]);
    expect(merged[0].used).toBe(9);
  });
});

describe('safeChartKey', () => {
  it('strips dots so Recharts will not treat the key as a nested path', () => {
    const cn = 'ovca1.site-a.example.com';
    const key = safeChartKey(cn);
    expect(key).toMatch(/^k_[A-Za-z0-9_]+$/);
    expect(key).not.toContain('.');
    const row = { time: '2026-09-03T12', [key]: 8.5 };
    expect(row[key]).toBe(8.5);
  });
});

describe('buildHourlyNodeSeries', () => {
  it('averages per hour under safe keys and leaves missing hours null', () => {
    const rows = buildHourlyNodeSeries(
      [
        { time: '2026-09-03T12:10:00', certname: 'web01.example.com', total: 10 },
        { time: '2026-09-03T12:40:00', certname: 'web01.example.com', total: 20 },
        { time: '2026-09-03T13:05:00', certname: 'db01.example.com', total: 30 },
      ],
      ['web01.example.com', 'db01.example.com'],
    );
    const kWeb = safeChartKey('web01.example.com');
    const kDb = safeChartKey('db01.example.com');
    expect(rows).toHaveLength(2);
    expect(rows[0].time).toBe('2026-09-03T12');
    expect(rows[0][kWeb]).toBe(15);
    expect(rows[0][kDb]).toBeNull();
    expect(rows[1][kDb]).toBe(30);
    expect(rows[1][kWeb]).toBeNull();
  });

  it('does not emit hours that only contain non-selected fleet nodes', () => {
    const rows = buildHourlyNodeSeries(
      [
        { time: '2026-09-03T12:10:00', certname: 'web01.example.com', total: 10 },
        { time: '2026-09-03T14:00:00', certname: 'other.example.com', total: 99 },
      ],
      ['web01.example.com'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].time).toBe('2026-09-03T12');
  });

  it('falls back to run_duration when time.total is zero', () => {
    const cn = 'web01.example.com';
    const rows = buildHourlyNodeSeries(
      [{ time: '2026-09-03T12:10:00', certname: cn, total: 0, run_duration: 42.5 }],
      [cn],
    );
    expect(rows[0][safeChartKey(cn)]).toBe(42.5);
  });
});

describe('jmxTimerToMs', () => {
  it('maps ns and µs to milliseconds and leaves ms alone', () => {
    expect(jmxTimerToMs(5_000_000)).toBe(5);
    expect(jmxTimerToMs(12.5)).toBe(12.5);
    expect(jmxTimerToMs(0.004)).toBe(0.004);
    expect(jmxTimerToMs(0)).toBe(0);
  });
});

describe('jmxMean', () => {
  it('reads Mean from a timer and ignores Jolokia error objects', () => {
    expect(jmxMean({ Mean: 5_000_000 })).toBe(5);
    expect(jmxMean({ error: 'InstanceNotFoundException', status: 404 })).toBe(0);
    expect(jmxMean(12.5)).toBe(12.5);
  });
});

describe('jmxGaugePct', () => {
  it('accepts a 0–1 ratio, a 0–100 gauge, or a bare number', () => {
    expect(jmxGaugePct({ Value: 0.85 })).toBeCloseTo(85);
    expect(jmxGaugePct(0.4)).toBeCloseTo(40);
    expect(jmxGaugePct({ Value: 92 })).toBe(92);
    expect(jmxGaugePct(null)).toBe(0);
  });
});

describe('chartSizeProps', () => {
  it('only forwards positive width and height so Recharts can paint axes', () => {
    expect(chartSizeProps(640, 200)).toEqual({ width: 640, height: 200 });
    expect(chartSizeProps(0, 200)).toEqual({ height: 200 });
    expect(chartSizeProps(undefined, undefined)).toEqual({});
  });
});

describe('formatDuration', () => {
  it('does not print 0.00ms for a non-zero value', () => {
    expect(formatDuration(0)).toBe('0');
    expect(formatDuration(0.004)).not.toBe('0.00ms');
    expect(formatDuration(0.004)).toMatch(/µs$/);
    expect(formatDuration(12.34)).toBe('12.3ms');
  });
});

describe('durationTickFormatter', () => {
  it('uses µs when the domain is sub-millisecond', () => {
    const fmt = durationTickFormatter(0.008);
    expect(fmt(0.004)).toBe('4µs');
    expect(fmt(0.008)).toBe('8µs');
  });
});

describe('prepareDurationOverlay', () => {
  it('normalizes when series peaks differ by more than 8x', () => {
    const { rows, normalized, maxes } = prepareDurationOverlay(
      [
        { time: 'a', store_report_ms: 8, store_facts_ms: 0.2, store_catalog_ms: 0 },
        { time: 'b', store_report_ms: 4, store_facts_ms: 0.1, store_catalog_ms: 0 },
      ],
      ['store_report_ms', 'store_facts_ms', 'store_catalog_ms'],
    );
    expect(normalized).toBe(true);
    expect(maxes.store_report_ms).toBe(8);
    expect(rows[0].store_report_ms).toBe(100);
    expect(rows[0].store_facts_ms).toBe(100);
    expect(rows[0].store_report_ms__raw).toBe(8);
    expect(rows[1].store_report_ms).toBe(50);
  });
});

describe('movingAverageSeries', () => {
  it('averages the trailing window and keeps time labels', () => {
    const rows = [
      { time: 'a', v: 0 },
      { time: 'b', v: 10 },
      { time: 'c', v: 20 },
    ];
    const out = movingAverageSeries(rows, ['v'], 2);
    expect(out.map((r) => r.time)).toEqual(['a', 'b', 'c']);
    expect(out[0].v).toBe(0);
    expect(out[1].v).toBe(5);
    expect(out[2].v).toBe(15);
  });

  it('skips non-finite values in the window', () => {
    const rows = [
      { time: 'a', v: 10 },
      { time: 'b', v: Number.NaN },
      { time: 'c', v: 20 },
    ];
    const out = movingAverageSeries(rows, ['v'], 3);
    expect(out[2].v).toBe(15);
  });
});

describe('smoothTimeSeries', () => {
  it('smooths numeric keys and leaves timestamp alone', () => {
    const rows = [
      { timestamp: 't0', failed: 0, compliant: 10 },
      { timestamp: 't1', failed: 10, compliant: 0 },
    ];
    const out = smoothTimeSeries(rows, 2);
    expect(out[1].timestamp).toBe('t1');
    expect(out[1].failed).toBe(5);
    expect(out[1].compliant).toBe(5);
  });
});

describe('defaultMaWindow', () => {
  it('grows with series length', () => {
    expect(defaultMaWindow(2)).toBe(1);
    expect(defaultMaWindow(8)).toBe(3);
    expect(defaultMaWindow(20)).toBe(5);
    expect(defaultMaWindow(80)).toBe(7);
    expect(defaultMaWindow(200)).toBe(11);
  });
});
