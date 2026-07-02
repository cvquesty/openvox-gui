import { useState, useEffect, useCallback, useRef } from 'react';
import { readSessionCache, writeSessionCache } from '../utils/sessionCache';

interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  /** True while a background refresh is in flight *and* prior data is shown. */
  refreshing: boolean;
  error: string | null;
  refetch: () => void;
}

export interface UseApiOptions<T> {
  /**
   * Seed data before the first network response (e.g. sessionStorage snapshot).
   * When set, `loading` starts false so the page can paint immediately.
   * Prefer `cacheKey` for automatic session persistence on graph pages.
   */
  initialData?: T | null;
  /**
   * When true (default), refetch after the first successful load does **not**
   * flip `loading` to true — the UI keeps showing prior data (stale-while-revalidate).
   * Critical for graph-heavy pages so auto-refresh does not unmount charts.
   */
  keepPreviousData?: boolean;
  /**
   * When set, seed from sessionStorage on mount and write successful payloads
   * back. Use a versioned key (e.g. `openvox_metrics_compliance_v1_24h`).
   * Graph-heavy Insights pages should pass this so return visits paint instantly.
   */
  cacheKey?: string;
  /** Optional validator — reject corrupt/empty cached shells. */
  cacheValidate?: (value: T) => boolean;
}

/**
 * useApi — stable data fetching hook with optional session cache (SWR).
 *
 * - Always deduplicates the underlying fetcher via ref so the latest version is used.
 * - refetch function identity is stable (never changes) to avoid effect loops.
 * - Auto-refetch triggers only when the *serialized value* of deps actually changes.
 * - After the first successful payload, subsequent refetches keep prior data
 *   on screen (unless keepPreviousData is false).
 * - Optional `cacheKey` persists last-good data in sessionStorage for instant
 *   paint on graph-heavy pages (same pattern as Overview | Dashboard).
 */
export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: any[] = [],
  options: UseApiOptions<T> = {},
): UseApiResult<T> {
  const {
    initialData = null,
    keepPreviousData = true,
    cacheKey,
    cacheValidate,
  } = options;

  // Resolve seed on first render only (explicit initialData or session cache).
  // When cacheKey changes with deps (e.g. compliance window hours), we re-seed
  // from the new key in an effect below so each filter has its own snapshot.
  const seedRef = useRef<T | null | undefined>(undefined);
  if (seedRef.current === undefined) {
    if (initialData != null) {
      seedRef.current = initialData;
    } else if (cacheKey) {
      seedRef.current = readSessionCache<T>(cacheKey, cacheValidate);
    } else {
      seedRef.current = null;
    }
  }
  const seed = seedRef.current;

  const [data, setData] = useState<T | null>(seed);
  const [loading, setLoading] = useState(seed == null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasDataRef = useRef(seed != null);
  const prevCacheKeyRef = useRef(cacheKey);

  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const keepPrevRef = useRef(keepPreviousData);
  keepPrevRef.current = keepPreviousData;

  const cacheKeyRef = useRef(cacheKey);
  cacheKeyRef.current = cacheKey;
  const cacheValidateRef = useRef(cacheValidate);
  cacheValidateRef.current = cacheValidate;

  const refetch = useCallback(() => {
    const showFullLoader = !(keepPrevRef.current && hasDataRef.current);
    if (showFullLoader) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);
    fetcherRef.current()
      .then((result) => {
        hasDataRef.current = true;
        setData(result);
        const key = cacheKeyRef.current;
        if (key) {
          const ok = !cacheValidateRef.current || cacheValidateRef.current(result);
          if (ok) writeSessionCache(key, result);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []); // stable identity forever

  // When cacheKey changes (window hours, timeline filters, …), prefer that
  // key's session snapshot immediately so charts do not flash empty.
  useEffect(() => {
    if (!cacheKey || cacheKey === prevCacheKeyRef.current) return;
    prevCacheKeyRef.current = cacheKey;
    const cached = readSessionCache<T>(cacheKey, cacheValidate);
    if (cached != null) {
      hasDataRef.current = true;
      setData(cached);
      setLoading(false);
    }
  }, [cacheKey, cacheValidate]);

  // Serialize deps for comparison so that callers can safely pass `[]` or
  // `[statusFilter]` inline on every render without causing a refetch on
  // identity change alone. Only a *value* change triggers.
  const depsKey = JSON.stringify(deps);

  useEffect(() => {
    refetch();
  }, [refetch, depsKey]);

  return { data, loading, refreshing, error, refetch };
}
