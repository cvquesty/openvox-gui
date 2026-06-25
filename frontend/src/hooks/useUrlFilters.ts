/**
 * URL search-param filters (sruiux1 P0 #4) — shareable list views.
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useUrlFilters(keys: string[]) {
  const [params, setParams] = useSearchParams();

  const values = useMemo(() => {
    const out: Record<string, string> = {};
    for (const k of keys) {
      out[k] = params.get(k) ?? '';
    }
    return out;
  }, [params, keys.join('|')]);

  const setFilter = useCallback(
    (key: string, value: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (!value) next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true }
      );
    },
    [setParams]
  );

  const setFilters = useCallback(
    (patch: Record<string, string>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (!v) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setParams]
  );

  const copyLink = useCallback(async () => {
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    await navigator.clipboard.writeText(url);
    return url;
  }, []);

  return { values, setFilter, setFilters, params, setParams, copyLink };
}
