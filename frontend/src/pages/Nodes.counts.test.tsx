/**
 * Nodes page header uses the fleet list, not classified + unclassified.
 * Issue #104: three unclassified nodes must read Nodes (3), not Nodes (6).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodesPage } from './Nodes';

const fleet = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

vi.mock('../services/api', () => ({
  nodes: {
    list: () => Promise.resolve(fleet.rows),
    dismiss: () => Promise.resolve({}),
  },
  bolt: {
    runCommand: () => Promise.resolve({}),
  },
  config: {
    getApp: () => Promise.resolve({}),
  },
}));

function sample(certname: string, environment?: string, groups: string[] = []) {
  return {
    certname,
    latest_report_status: 'unchanged',
    report_timestamp: '2026-10-12T00:00:00Z',
    catalog_timestamp: null,
    facts_timestamp: null,
    report_environment: environment ?? null,
    latest_report_noop: false,
    latest_report_corrective_change: false,
    deactivated: null,
    expired: null,
    enc_environment: environment ?? null,
    enc_groups: groups,
  };
}

describe('NodesPage counts', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    sessionStorage.clear();
    fleet.rows = [];
    if (!('ResizeObserver' in window)) {
      class ResizeObserverPolyfill {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
      (window as unknown as { ResizeObserver: typeof ResizeObserverPolyfill }).ResizeObserver =
        ResizeObserverPolyfill;
    }
    if (!window.matchMedia) {
      window.matchMedia = (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      });
    }
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  async function renderNodes() {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <MantineProvider>
          <MemoryRouter>
            <NodesPage />
          </MemoryRouter>
        </MantineProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    return container;
  }

  function text(el: HTMLElement) {
    return el.textContent || '';
  }

  it('shows 3 for a fully unclassified 3-node fleet', async () => {
    fleet.rows = [
      sample('node1.example'),
      sample('node2.example'),
      sample('node3.example'),
    ];
    const el = await renderNodes();
    const body = text(el);
    expect(body).toContain('Nodes (3)');
    expect(body).not.toContain('Nodes (6)');
    expect(body).toContain('Classified Nodes (0)');
    expect(body).toContain('All Nodes (3)');
    expect(body).toContain('Unclassified Nodes (3)');
  });

  it('keeps partial and fully classified fleets consistent', async () => {
    fleet.rows = [
      sample('web.example', 'production', ['web', 'db']),
      sample('lone.example', 'production', []),
      sample('new.example'),
    ];
    let el = await renderNodes();
    expect(text(el)).toContain('Nodes (3)');
    expect(text(el)).toContain('Classified Nodes (2)');
    expect(text(el)).toContain('Unclassified Nodes (1)');
    expect(text(el)).toContain('All Nodes (3)');
    // web.example is in two groups. Membership lines overlap; the header does not.
    expect(text(el)).toContain('Ungrouped');
    expect(text(el)).not.toContain('Nodes (4)');
    expect(text(el)).not.toContain('Classified Nodes (3)');

    act(() => {
      root?.unmount();
    });
    container?.remove();
    sessionStorage.clear();
    fleet.rows = [
      sample('a.example', 'production', ['web']),
      sample('b.example', 'production', ['db']),
    ];
    el = await renderNodes();
    expect(text(el)).toContain('Nodes (2)');
    expect(text(el)).toContain('Classified Nodes (2)');
    expect(text(el)).toContain('Unclassified Nodes (0)');
    expect(text(el)).not.toContain('Nodes (4)');
  });

  it('does not show a summed total while the fleet list has not loaded', async () => {
    let resolveList: (rows: unknown[]) => void = () => {};
    const pending = new Promise((resolve) => {
      resolveList = resolve;
    });
    const api = await import('../services/api');
    vi.spyOn(api.nodes, 'list').mockImplementation(() => pending as Promise<never>);

    const el = await renderNodes();
    expect(text(el)).toContain('Loading nodes');
    expect(text(el)).not.toContain('Nodes (');

    await act(async () => {
      resolveList([
        sample('node1.example'),
        sample('node2.example'),
        sample('node3.example'),
      ]);
      await pending;
    });
    expect(text(el)).toContain('Nodes (3)');
    expect(text(el)).not.toContain('Nodes (6)');
  });
});
