/**
 * Where to send someone after they sign in.
 *
 * Login is a mode, not a /login route: while signed out the address bar
 * still holds the deep link. We also keep a tab-scoped copy so a session
 * expiry is remembered even if the URL is later the dashboard root.
 * Only same-origin in-app paths are accepted (no open redirects).
 */

const STORAGE_KEY = 'openvox-gui-return-to';

export type ReturnLocation = {
  pathname: string;
  search?: string;
  hash?: string;
  state?: unknown;
};

/** In-app path only. Rejects protocol-relative and absolute URLs. */
export function sanitizeReturnTo(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('\\') || value.includes('://')) return null;
  if (/[\u0000-\u001F\u007F]/.test(value)) return null;
  return value;
}

function pathFromUnknown(value: unknown): string | null {
  if (typeof value === 'string') return sanitizeReturnTo(value);
  if (!value || typeof value !== 'object' || !('pathname' in value)) return null;
  const loc = value as { pathname?: unknown; search?: unknown; hash?: unknown };
  if (typeof loc.pathname !== 'string') return null;
  const search = typeof loc.search === 'string' ? loc.search : '';
  const hash = typeof loc.hash === 'string' ? loc.hash : '';
  return sanitizeReturnTo(`${loc.pathname}${search}${hash}`);
}

/**
 * Intended destination for the current location.
 * Order: location.state.from, then ?next=, then pathname + search + hash.
 */
export function destinationFromLocation(loc: ReturnLocation): string {
  const state = loc.state as { from?: unknown } | null | undefined;
  const fromState = pathFromUnknown(state?.from);
  if (fromState) return fromState;

  const search = loc.search || '';
  const query = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  const next = params.get('next');
  if (next) {
    const fromNext = sanitizeReturnTo(next);
    if (fromNext) return fromNext;
    // Drop an unsafe next so "://" in the query cannot blank the rest of the URL.
    params.delete('next');
    const rest = params.toString();
    const cleaned = `${loc.pathname || '/'}${rest ? `?${rest}` : ''}${loc.hash || ''}`;
    return sanitizeReturnTo(cleaned) || '/';
  }

  const path = `${loc.pathname || '/'}${search}${loc.hash || ''}`;
  return sanitizeReturnTo(path) || '/';
}

export function browserReturnTo(): string {
  if (typeof window === 'undefined') return '/';
  return destinationFromLocation({
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
  });
}

export function rememberReturnTo(path: string): void {
  const safe = sanitizeReturnTo(path);
  try {
    if (!safe || safe === '/') {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(STORAGE_KEY, safe);
  } catch {
    /* private mode / disabled storage */
  }
}

export function peekReturnTo(): string | null {
  try {
    return sanitizeReturnTo(sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function consumeReturnTo(): string | null {
  const value = peekReturnTo();
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return value;
}

/**
 * Live URL wins when it is a deep link (login does not change the path).
 * The saved value is the fallback when the address bar is only "/".
 */
export function resolvePostLoginDestination(here: string, saved: string | null): string {
  const current = sanitizeReturnTo(here) || '/';
  if (current !== '/') return current;
  return sanitizeReturnTo(saved) || '/';
}
