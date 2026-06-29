/**
 * MonitoringHistoryContext
 *
 * Provides persistent, always-collecting history buffers for the live
 * high-resolution series used by the Insights | Monitoring wallboard.
 *
 * Goals:
 * - Graphs keep accumulating trends even when you navigate to other pages.
 * - Full history + current data is available when you return to Monitoring.
 * - Survives focus changes (with visibility catch-up).
 * - Uses the same merge + localStorage keys the wallboard expects.
 *
 * The collector runs for the lifetime of the SPA tab (subject to visibility throttling).
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { metrics, performance as perfApi } from '../services/api';

const PERF_HIST_KEY = 'openvox_monitor_perf_hist_v2';
const PS_HIST_KEY = 'openvox_monitor_ps_hist_v3';
const PDB_HIST_KEY = 'openvox_monitor_pdb_hist_v3';
const MAX_HIST = 2000;

type AnyPoint = Record<string, any>;

interface MonitoringHistoryContextValue {
  perfServerHist: AnyPoint[];
  psHist: AnyPoint[];
  pdbHist: AnyPoint[];
  refreshHistories: () => Promise<void>;
  isCollecting: boolean;
}

const MonitoringHistoryContext = createContext<MonitoringHistoryContextValue | null>(null);

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, val: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* ignore quota */
  }
}

function toEpochMs(v: any): number | null {
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  if (typeof v === 'string') {
    const n = Date.parse(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function hourKeyFromMs(ms: number | null | undefined): string {
  const safe = ms ?? Date.now();
  const d = new Date(safe);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function pointEpochMs(p: any, timeField = 'time'): number | null {
  if (!p) return null;
  if (typeof p.ts === 'number') return toEpochMs(p.ts);
  if (typeof p.t === 'number') return toEpochMs(p.t);
  const tf = p[timeField];
  if (typeof tf === 'string' && tf.includes(':')) {
    // best effort recent time
    const now = Date.now();
    return now;
  }
  return null;
}

function mergeHistByTs(prev: AnyPoint[], incoming: AnyPoint[], max = MAX_HIST): AnyPoint[] {
  const byTs = new Map<number, AnyPoint>();
  for (const p of [...(prev || []), ...(incoming || [])]) {
    if (!p || typeof p !== 'object') continue;
    let ts = toEpochMs(p.ts) ?? toEpochMs(p.t) ?? pointEpochMs(p);
    if (ts == null || !Number.isFinite(ts) || Number.isNaN(ts)) continue;
    const prevPt = byTs.get(ts) || { ts, time: hourKeyFromMs(ts) };
    const next = { ...prevPt, ...p, ts, time: p.time || hourKeyFromMs(ts) };
    byTs.set(ts, next);
  }
  return Array.from(byTs.values())
    .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    .slice(-max);
}

function extractHttpRouteMeans(result: any) {
  let catalog = result?.http_catalog_mean ?? result?.http?.catalog_mean;
  let report = result?.http_report_mean ?? result?.http?.report_mean;
  for (const hm of result?.http_metrics || []) {
    const r = String(hm?.route || hm?.name || '').toLowerCase();
    const mean = hm?.mean ?? hm?.Mean;
    if (mean == null || Number.isNaN(Number(mean))) continue;
    if (r.includes('catalog')) catalog = Number(mean);
    else if (r.includes('report')) report = Number(mean);
  }
  return {
    catalog: catalog != null ? Number(catalog) : undefined,
    report: report != null ? Number(report) : undefined,
  };
}

export function MonitoringHistoryProvider({ children }: { children: ReactNode }) {
  const [perfServerHist, setPerfServerHist] = useState<AnyPoint[]>(() =>
    loadJson<AnyPoint[]>(PERF_HIST_KEY, [])
  );
  const [psHist, setPsHist] = useState<AnyPoint[]>(() => {
    const cur = loadJson<AnyPoint[]>(PS_HIST_KEY, []);
    const legacyMonitor = loadJson<any[]>('openvox_monitor_ps_hist_v2', []);
    const legacyPage = loadJson<any[]>('openvox_ps_health_history', []);
    return mergeHistByTs(mergeHistByTs(cur, legacyMonitor), legacyPage).map((p) => {
      const tsVal = (typeof p.ts === 'number' ? toEpochMs(p.ts) : null) || Date.now();
      return {
        ...p,
        ts: tsVal,
        time: p.time || hourKeyFromMs(tsVal),
      };
    });
  });
  const [pdbHist, setPdbHist] = useState<AnyPoint[]>(() => {
    const cur = loadJson<AnyPoint[]>(PDB_HIST_KEY, []);
    const legacyMonitor = loadJson<any[]>('openvox_monitor_pdb_hist_v2', []);
    const legacyPage = loadJson<any[]>('openvox_pdb_heap_history', []);
    return mergeHistByTs(mergeHistByTs(cur, legacyMonitor), legacyPage);
  });

  const [isCollecting, setIsCollecting] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isFetchingRef = useRef(false);

  const appendPerfPoint = useCallback((point: AnyPoint) => {
    setPerfServerHist((prev) => {
      const updated = mergeHistByTs(prev, [point]);
      saveJson(PERF_HIST_KEY, updated);
      return updated;
    });
  }, []);

  const appendPsPoints = useCallback((points: AnyPoint[]) => {
    setPsHist((prev) => {
      const updated = mergeHistByTs(prev, points);
      saveJson(PS_HIST_KEY, updated);
      return updated;
    });
  }, []);

  const appendPdbPoint = useCallback((point: AnyPoint) => {
    setPdbHist((prev) => {
      const updated = mergeHistByTs(prev, [point]);
      saveJson(PDB_HIST_KEY, updated);
      return updated;
    });
  }, []);

  const fetchLatest = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    const tsNow = Date.now();

    try {
      // Perf / Server side detailed points (used by several Run Perf graphs in monitor)
      try {
        const [perf, server] = await Promise.all([
          perfApi.getOverview().catch(() => null),
          metrics.puppetdbPerformance().catch(() => null),
        ]);
        if (server) {
          const point: AnyPoint = {
            ts: tsNow,
            time: hourKeyFromMs(tsNow),
            catalog_ms: Number(server.catalog_processing?.Mean) || 0,
            facts_ms: Number(server.facts_processing?.Mean) || 0,
            report_ms: Number(server.report_processing?.Mean) || 0,
            store_catalog_ms: Number(server.store_catalog?.Mean) / 1000 || 0,
            store_facts_ms: Number(server.store_facts?.Mean) / 1000 || 0,
            store_report_ms: Number(server.store_report?.Mean) / 1000 || 0,
            http_query_ms: Number(server.http_query_time?.Mean) || 0,
            http_cmd_ms: Number(server.http_cmd_time?.Mean) || 0,
            write_active: Number(server.write_pool_active?.Value) || 0,
            write_idle: Number(server.write_pool_idle?.Value) || 0,
            read_active: Number(server.read_pool_active?.Value) || 0,
            read_idle: Number(server.read_pool_idle?.Value) || 0,
            write_pending: Number(server.write_pool_pending?.Value) || 0,
            read_pending: Number(server.read_pool_pending?.Value) || 0,
            hash_match_ms: Number(server.catalog_hash_match?.Mean) / 1000 || 0,
            hash_miss_ms: Number(server.catalog_hash_miss?.Mean) / 1000 || 0,
            gc_young_count: Number(server.gc_young?.CollectionCount) || 0,
            gc_old_count: Number(server.gc_old?.CollectionCount) || 0,
            nodes: Number(server.population_nodes?.Value) || 0,
            avg_resources: Number(server.population_avg_resources?.Value) || 0,
          };
          appendPerfPoint(point);
        }
      } catch {
        /* non fatal */
      }

      // Puppet Server (PS) health — backend also has a ring, we merge whatever we get
      try {
        const result = await metrics.puppetserverHealth();
        const routes = extractHttpRouteMeans(result);
        const fromApi: AnyPoint[] = (result?.history || []).map((p: any, idx: number) => {
          let ms = typeof p.ts === 'number' ? toEpochMs(p.ts) : Date.parse(p.time);
          if (!Number.isFinite(ms) || Number.isNaN(ms)) {
            ms = tsNow - ((result.history?.length || 1) - idx) * 10_000;
          }
          const pr = extractHttpRouteMeans(p);
          return {
            ts: ms,
            time: hourKeyFromMs(ms),
            heap_used_mb: p.heap_used_mb ?? p.jvm_heap?.used_mb,
            nonheap_used_mb: p.nonheap_used_mb ?? p.jvm_nonheap?.used_mb,
            http_catalog_mean: p.http_catalog_mean ?? pr.catalog,
            http_report_mean: p.http_report_mean ?? pr.report,
            gc_young_time: p.gc_young_time ?? p.gc_young?.time_ms,
            gc_old_time: p.gc_old_time ?? p.gc_old?.time_ms,
            process_cpu_load: p.process_cpu_load ?? p.os?.process_cpu_load,
            open_fds: p.open_fds ?? p.os?.open_file_descriptors,
          };
        });
        const snap: AnyPoint = {
          ts: tsNow,
          time: hourKeyFromMs(tsNow),
          heap_used_mb: result?.jvm_heap?.used_mb,
          nonheap_used_mb: result?.jvm_nonheap?.used_mb,
          http_catalog_mean: routes.catalog,
          http_report_mean: routes.report,
          gc_young_time: result?.gc_young?.time_ms,
          gc_old_time: result?.gc_old?.time_ms,
          process_cpu_load: result?.os?.process_cpu_load,
          open_fds: result?.os?.open_file_descriptors,
        };
        appendPsPoints([...fromApi, snap]);
      } catch {
        /* leave prior */
      }

      // PuppetDB health
      try {
        const result = await metrics.puppetdbHealth();
        const jvm = result.jvm_heap || {};
        const pdbm = result.ps_puppetdb_metrics || [];
        const findMean = (arr: any[], key: string) =>
          arr.find((x: any) => (x.metric || '').includes(key))?.mean;

        const point: AnyPoint = {
          ts: tsNow,
          time: hourKeyFromMs(tsNow),
          used_mb: jvm.used_mb ?? 0,
          queue_depth: Math.max(0, Number(result.queue_depth) || 0),
          catalog_save_mean: findMean(pdbm, 'catalog_save'),
          report_process_mean: findMean(pdbm, 'report_process'),
        };
        appendPdbPoint(point);
      } catch {
        /* leave prior */
      }
    } finally {
      isFetchingRef.current = false;
    }
  }, [appendPerfPoint, appendPsPoints, appendPdbPoint]);

  // Background collector — always running while SPA is loaded.
  // We slow down when the tab is hidden to be nice to the server.
  const getIntervalMs = () =>
    document.visibilityState === 'hidden' ? 60_000 : 15_000;

  useEffect(() => {
    // initial catch-up
    fetchLatest();

    if (intervalRef.current) clearInterval(intervalRef.current);

    let ms = getIntervalMs();
    intervalRef.current = setInterval(() => {
      fetchLatest();
    }, ms);

    setIsCollecting(true);

    const onVis = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      const nextMs = getIntervalMs();
      intervalRef.current = setInterval(() => fetchLatest(), nextMs);
      if (document.visibilityState === 'visible') {
        fetchLatest(); // catch up immediately on return
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      document.removeEventListener('visibilitychange', onVis);
      setIsCollecting(false);
    };
  }, [fetchLatest]);

  // Catch-up when the browser tab regains focus
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // give the user fresh data + any points collected on backend while away
        fetchLatest();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [fetchLatest]);

  const refreshHistories = useCallback(async () => {
    await fetchLatest();
  }, [fetchLatest]);

  const value = useMemo(
    () => ({
      perfServerHist,
      psHist,
      pdbHist,
      refreshHistories,
      isCollecting,
    }),
    [perfServerHist, psHist, pdbHist, refreshHistories, isCollecting]
  );

  return (
    <MonitoringHistoryContext.Provider value={value}>
      {children}
    </MonitoringHistoryContext.Provider>
  );
}

export function useMonitoringHistory() {
  const ctx = useContext(MonitoringHistoryContext);
  if (!ctx) {
    // Safe fallback if provider not present (should not happen in normal app)
    return {
      perfServerHist: [] as AnyPoint[],
      psHist: [] as AnyPoint[],
      pdbHist: [] as AnyPoint[],
      refreshHistories: async () => {},
      isCollecting: false,
    };
  }
  return ctx;
}
