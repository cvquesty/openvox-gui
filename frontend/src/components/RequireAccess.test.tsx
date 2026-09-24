import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { installDomShims } from '../test/domShims';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireAccess } from './RequireAccess';

const auth = vi.hoisted(() => ({ role: 'viewer' }));

vi.mock('../hooks/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'ada', role: auth.role } }),
}));

function PageMarker() {
  return <div>mutate-page</div>;
}

function mount(path: string) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(
      <MantineProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<RequireAccess />}>
              <Route path="/orchestration" element={<PageMarker />} />
              <Route path="/nodes" element={<PageMarker />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );
  });
  return { el, root };
}

describe('RequireAccess', () => {
  let mounted: { el: HTMLDivElement; root: Root } | null = null;

  beforeEach(() => {
    installDomShims();
    auth.role = 'viewer';
  });

  afterEach(() => {
    if (mounted) {
      act(() => mounted?.root.unmount());
      mounted.el.remove();
      mounted = null;
    }
  });

  it('shows a read-only state for viewers and does not mount the mutate page', () => {
    mounted = mount('/orchestration');
    expect(mounted.el.textContent).toContain('Read-only access');
    expect(mounted.el.textContent).not.toContain('mutate-page');
  });

  it('lets viewers open routes that are not in the hidden set', () => {
    mounted = mount('/nodes');
    expect(mounted.el.textContent).toContain('mutate-page');
    expect(mounted.el.textContent).not.toContain('Read-only access');
  });

  it('lets admin, operator, and certops open mutate routes', () => {
    for (const role of ['admin', 'operator', 'certops']) {
      auth.role = role;
      const view = mount('/orchestration');
      expect(view.el.textContent).toContain('mutate-page');
      act(() => view.root.unmount());
      view.el.remove();
    }
    mounted = null;
  });
});
