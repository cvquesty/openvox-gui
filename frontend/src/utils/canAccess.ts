/**
 * Route access for GUI roles.
 *
 * Viewer is the only restricted role: the same mutate paths that used to
 * be hidden in the sidebar only. admin, operator, and certops keep those
 * routes (page-level buttons still apply finer checks, such as certops
 * on certificates). A missing role is not treated as viewer — that matches
 * the previous nav filter, which hid paths only when role === 'viewer'.
 */

export const VIEWER_HIDDEN_PATHS: readonly string[] = [
  '/orchestration',
  '/deployment',
  '/installer',
  '/data/hiera',
  '/config/puppet',
  '/config/app',
];

const VIEWER_HIDDEN = new Set<string>(VIEWER_HIDDEN_PATHS);

/** Pathname only: drop query, hash, and a trailing slash (except "/"). */
export function normalizeAccessPath(path: string): string {
  const raw = (path || '').trim();
  if (!raw) return '/';
  const noQuery = raw.split(/[?#]/, 1)[0] || '/';
  const withSlash = noQuery.startsWith('/') ? noQuery : `/${noQuery}`;
  if (withSlash.length > 1 && withSlash.endsWith('/')) {
    return withSlash.replace(/\/+$/, '') || '/';
  }
  return withSlash;
}

export function canAccessPath(path: string, role?: string | null): boolean {
  if (role !== 'viewer') return true;
  const normalized = normalizeAccessPath(path);
  for (const hidden of VIEWER_HIDDEN) {
    if (normalized === hidden || normalized.startsWith(`${hidden}/`)) return false;
  }
  return true;
}

/** Palette rows without a path (local commands) stay visible. */
export function canAccessPaletteAction(
  action: { path?: string },
  role?: string | null,
): boolean {
  if (!action.path) return true;
  return canAccessPath(action.path, role);
}
