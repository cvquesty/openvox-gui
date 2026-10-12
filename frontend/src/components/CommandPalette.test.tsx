import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommandPalette } from './CommandPalette';
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
