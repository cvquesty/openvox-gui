import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { installDomShims } from '../test/domShims';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './Login';

const auth = vi.hoisted(() => ({
  login: vi.fn(async () => {}),
}));

vi.mock('../hooks/AuthContext', () => ({
  useAuth: () => ({ login: auth.login }),
}));

vi.mock('../hooks/ThemeContext', () => ({
  useAppTheme: () => ({ isDark: false }),
}));

vi.mock('../services/api', () => ({
  config: { getAppName: () => Promise.resolve({ app_name: 'OpenVox GUI' }) },
}));

vi.mock('../version', () => ({ APP_VERSION: 'test' }));

function Where() {
  const location = useLocation();
  return <div data-where="">{location.pathname}{location.search}{location.hash}</div>;
}

function mount(entry: string) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(
      <MantineProvider>
        <MemoryRouter initialEntries={[entry]}>
          <LoginPage />
          <Routes>
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );
  });
  return { el, root };
}

async function signIn(el: HTMLElement) {
  const inputs = el.querySelectorAll('input');
  const user = inputs[0] as HTMLInputElement;
  const pass = inputs[1] as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(user, 'ada');
    user.dispatchEvent(new Event('input', { bubbles: true }));
    setter?.call(pass, 'secret');
    pass.dispatchEvent(new Event('input', { bubbles: true }));
    el.querySelector('form')?.requestSubmit();
  });
}

describe('LoginPage return path', () => {
  let mounted: { el: HTMLDivElement; root: Root } | null = null;

  beforeEach(() => {
    installDomShims();
    sessionStorage.clear();
    auth.login.mockClear();
    auth.login.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (mounted) {
      act(() => mounted?.root.unmount());
      mounted.el.remove();
      mounted = null;
    }
  });

  it('navigates to the current deep link instead of reloading the dashboard', async () => {
    mounted = mount('/nodes/web.example?status=failed#facts');
    await signIn(mounted.el);
    expect(auth.login).toHaveBeenCalledWith('ada', 'secret');
    expect(mounted.el.querySelector('[data-where]')?.textContent).toBe(
      '/nodes/web.example?status=failed#facts',
    );
  });

  it('follows a safe ?next= and ignores an off-site next', async () => {
    mounted = mount('/?next=/reports/abc');
    await signIn(mounted.el);
    expect(mounted.el.querySelector('[data-where]')?.textContent).toBe('/reports/abc');
    act(() => mounted?.root.unmount());
    mounted?.el.remove();

    mounted = mount('/?next=https://evil.example/phish');
    await signIn(mounted.el);
    expect(mounted.el.querySelector('[data-where]')?.textContent).toBe('/');
  });
});
