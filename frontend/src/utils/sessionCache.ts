/**
 * sessionStorage helpers for graph/metrics pages (stale-while-revalidate).
 *
 * Same pattern as Overview | Dashboard: show the last good payload instantly
 * on return visits in the same tab, then refresh in the background.
 *
 * Keys should be versioned (e.g. openvox_metrics_compliance_v1) so shape
 * changes do not resurrect incompatible JSON.
 */

export function readSessionCache<T = unknown>(
  key: string,
  isValid?: (value: T) => boolean,
): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as T;
    if (isValid && !isValid(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSessionCache(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode — ignore */
  }
}

export function clearSessionCache(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
