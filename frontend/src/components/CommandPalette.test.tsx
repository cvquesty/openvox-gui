import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommandPalette, INSIGHTS_HUB_PALETTE_PATH } from './CommandPalette';
import { installDomShims } from '../test/domShims';

const RECENT_KEY = 'openvox-gui-palette-recent';

function mount(role: string) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(
      <MantineProvider>
        <MemoryRouter>
          <CommandPalette opened onClose={() => {}} role={role} />
        </MemoryRouter>
      </MantineProvider>,
    );
  });
  return { el, root };
}

describe('CommandPalette role filter', () => {
  let mounted: { el: HTMLDivElement; root: Root } | null = null;

  beforeEach(() => {
    installDomShims();
    localStorage.setItem(RECENT_KEY, JSON.stringify([
      { id: 'orch', label: 'Orchestration (Bolt)', path: '/orchestration' },
      { id: 'nodes', label: 'Nodes', path: '/nodes' },
    ]));
  });

  afterEach(() => {
    if (mounted) {
      act(() => mounted?.root.unmount());
      mounted.el.remove();
      mounted = null;
    }
    localStorage.removeItem(RECENT_KEY);
  });

  it('hides mutate actions and their recents from viewers', () => {
    mounted = mount('viewer');
    const text = document.body.textContent || '';
    expect(text).toContain('Nodes');
    expect(text).toContain('Recent: Nodes');
    expect(text).not.toContain('Orchestration');
    expect(text).not.toContain('Code Deployment');
    expect(text).not.toContain('Agent Installer');
    expect(text).not.toContain('Hiera Data Files');
    expect(text).not.toContain('Application Configuration');
  });

  it('keeps mutate actions for roles that can change the estate', () => {
    mounted = mount('operator');
    const text = document.body.textContent || '';
    expect(text).toContain('Orchestration (Bolt)');
    expect(text).toContain('Code Deployment (r10k)');
    expect(text).toContain('Recent: Orchestration (Bolt)');
  });
});

function Where() {
  const location = useLocation();
  return <div data-where="">{location.pathname}</div>;
}

describe('CommandPalette keyboard', () => {
  let mounted: { el: HTMLDivElement; root: Root } | null = null;

  beforeEach(() => {
    installDomShims();
    localStorage.removeItem(RECENT_KEY);
  });

  afterEach(() => {
    if (mounted) {
      act(() => mounted?.root.unmount());
      mounted.el.remove();
      mounted = null;
    }
  });

  it('moves the active option and opens that path on Enter', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    act(() => {
      root.render(
        <MantineProvider>
          <MemoryRouter initialEntries={['/']}>
            <CommandPalette opened onClose={() => {}} role="admin" />
            <Routes>
              <Route path="*" element={<Where />} />
            </Routes>
          </MemoryRouter>
        </MantineProvider>,
      );
    });
    mounted = { el, root };

    const input = document.querySelector('[role="combobox"]') as HTMLInputElement;
    expect(input.getAttribute('aria-activedescendant')).toBeTruthy();
    const first = document.getElementById(input.getAttribute('aria-activedescendant') || '');
    expect(first?.textContent).toContain('Dashboard');

    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    const secondId = input.getAttribute('aria-activedescendant');
    expect(document.getElementById(secondId || '')?.textContent).toContain('Nodes');

    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(document.querySelector('[data-where]')?.textContent).toBe('/nodes');
  });

  it('points the insights hub action at the catalog', () => {
    expect(INSIGHTS_HUB_PALETTE_PATH).toBe('/insights/all');
  });
});
