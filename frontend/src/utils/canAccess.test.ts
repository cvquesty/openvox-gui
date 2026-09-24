import { describe, expect, it } from 'vitest';
import {
  VIEWER_HIDDEN_PATHS,
  canAccessPaletteAction,
  canAccessPath,
} from './canAccess';

const MUTATE_ROLES = ['admin', 'operator', 'certops', undefined, null, ''] as const;

describe('canAccessPath', () => {
  it('blocks viewers from the sidebar-hidden mutate paths, including children and query', () => {
    for (const path of VIEWER_HIDDEN_PATHS) {
      expect(canAccessPath(path, 'viewer')).toBe(false);
      expect(canAccessPath(`${path}/`, 'viewer')).toBe(false);
      expect(canAccessPath(`${path}?x=1`, 'viewer')).toBe(false);
      expect(canAccessPath(`${path}#section`, 'viewer')).toBe(false);
      expect(canAccessPath(`${path}/extra`, 'viewer')).toBe(false);
    }
  });

  it('lets viewers open read-only fleet, classifier, lookup, and insights routes', () => {
    for (const path of [
      '/',
      '/nodes',
      '/nodes/agent.example',
      '/reports',
      '/enc',
      '/certificates',
      '/cert-audit',
      '/data/lookup',
      '/data/hierarchical',
      '/config/ssl',
      '/insights',
      '/insights/all',
      '/pql',
      '/installer-notes',
    ]) {
      expect(canAccessPath(path, 'viewer')).toBe(true);
    }
  });

  it('leaves mutate routes open for every non-viewer role', () => {
    for (const role of MUTATE_ROLES) {
      for (const path of VIEWER_HIDDEN_PATHS) {
        expect(canAccessPath(path, role)).toBe(true);
      }
    }
  });
});

describe('canAccessPaletteAction', () => {
  it('drops forbidden paths and keeps pathless commands', () => {
    expect(canAccessPaletteAction({ path: '/orchestration' }, 'viewer')).toBe(false);
    expect(canAccessPaletteAction({ path: '/nodes' }, 'viewer')).toBe(true);
    expect(canAccessPaletteAction({ path: '/deployment' }, 'admin')).toBe(true);
    expect(canAccessPaletteAction({}, 'viewer')).toBe(true);
  });
});
