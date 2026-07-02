import { useState, useEffect, useCallback, useRef } from 'react';

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
   */
  initialData?: T | null;
  /**
   * When true (default), refetch after the first successful load does **not**
   * flip `loading` to true — the UI keeps showing prior data (stale-while-revalidate).
   * Critical for Overview | Dashboard so auto-refresh does not unmount the page.
   */
  keepPreviousData?: boolean;
}

/**
 * useApi — stable data fetching hook.
 *
 * - Always deduplicates the underlying fetcher via ref so the latest version is used.
 * - refetch function identity is stable (never changes) to avoid effect loops.
 * - Auto-refetch triggers only when the *serialized value* of deps actually changes
 *   (handles literal [] or [status] passed fresh each render without causing
 *   re-fetch storms on every re-render).
 * - This prevents the previous behavior where passing inline deps arrays caused
 *   the effect to re-run (and network fetch) on every render of the host component.
 * - After the first successful payload, subsequent refetches keep prior data
 *   on screen (unless keepPreviousData is false).
 */
export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: any[] = [],
  options: UseApiOptions<T> = {},
): UseApiResult<T> {
  const { initialData = null, keepPreviousData = true } = options;
  const [data, setData] = useState<T | null>(initialData ?? null);
  const [loading, setLoading] = useState(initialData == null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasDataRef = useRef(initialData != null);

  // Keep the latest fetcher in a ref so refetch() (which is stable) always
  // calls the most recent closure the caller provided (e.g. one that closed
  // over current filter state).
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const keepPrevRef = useRef(keepPreviousData);
  keepPrevRef.current = keepPreviousData;

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
      })
      .catch((e) => setError(e.message))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []); // stable identity forever

  // Serialize deps for comparison so that callers can safely pass `[]` or
  // `[statusFilter]` inline on every render without causing a refetch on
  // identity change alone. Only a *value* change triggers.
  const depsKey = JSON.stringify(deps);

  useEffect(() => {
    refetch();
  }, [refetch, depsKey]);

  return { data, loading, refreshing, error, refetch };
}
