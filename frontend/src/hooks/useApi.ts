import { useState, useEffect, useCallback, useRef } from 'react';

interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
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
 */
export function useApi<T>(fetcher: () => Promise<T>, deps: any[] = []): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Keep the latest fetcher in a ref so refetch() (which is stable) always
  // calls the most recent closure the caller provided (e.g. one that closed
  // over current filter state).
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    fetcherRef.current()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []); // stable identity forever

  // Serialize deps for comparison so that callers can safely pass `[]` or
  // `[statusFilter]` inline on every render without causing a refetch on
  // identity change alone. Only a *value* change triggers.
  const depsKey = JSON.stringify(deps);

  useEffect(() => {
    refetch();
  }, [refetch, depsKey]);

  return { data, loading, error, refetch };
}
