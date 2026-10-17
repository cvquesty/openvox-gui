import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpsTable } from './OpsTable';
import { installDomShims } from '../test/domShims';

function Where() {
  const location = useLocation();
  return <div data-where="">{location.pathname}</div>;
}

function mount(ui: ReactNode) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(
      <MantineProvider>
        <MemoryRouter initialEntries={['/']}>
          {ui}
          <Routes>
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );
  });
  return { el, root };
}

const columns = [
  { key: 'name', header: 'Name', render: (row: { name: string }) => row.name },
];

describe('OpsTable keyboard rows', () => {
  let mounted: { el: HTMLDivElement; root: Root } | null = null;

  beforeEach(() => installDomShims());

  afterEach(() => {
    if (mounted) {
      act(() => mounted?.root.unmount());
      mounted.el.remove();
      mounted = null;
    }
  });

  it('renders a real link for rowHref', () => {
    mounted = mount(
      <OpsTable
        data={[{ name: 'web.example' }]}
        rowKey={(row) => row.name}
        columns={columns}
        rowHref={(row) => `/nodes/${row.name}`}
      />,
    );
    const link = mounted.el.querySelector('a.ov-row-link');
    expect(link?.getAttribute('href')).toBe('/nodes/web.example');
    expect(link?.textContent).toContain('web.example');
  });

  it('activates onRowClick from the keyboard', () => {
    const onRowClick = vi.fn();
    mounted = mount(
      <OpsTable
        data={[{ name: 'db.example' }]}
        rowKey={(row) => row.name}
        columns={columns}
        onRowClick={onRowClick}
      />,
    );
    const row = mounted.el.querySelector('tbody tr');
    expect(row?.getAttribute('tabindex')).toBe('0');
    act(() => {
      row?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onRowClick).toHaveBeenCalledWith({ name: 'db.example' });
    act(() => {
      row?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    expect(onRowClick).toHaveBeenCalledTimes(2);
  });
});
