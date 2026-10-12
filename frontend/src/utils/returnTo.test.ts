import { afterEach, describe, expect, it } from 'vitest';
import {
  consumeReturnTo,
  destinationFromLocation,
  peekReturnTo,
  rememberReturnTo,
  resolvePostLoginDestination,
  sanitizeReturnTo,
} from './returnTo';

afterEach(() => {
  sessionStorage.clear();
});

describe('sanitizeReturnTo', () => {
  it('keeps in-app paths and rejects open redirects', () => {
    expect(sanitizeReturnTo('/nodes/a?status=failed#top')).toBe('/nodes/a?status=failed#top');
    expect(sanitizeReturnTo(' /orchestration ')).toBe('/orchestration');
    expect(sanitizeReturnTo('/')).toBe('/');
    expect(sanitizeReturnTo('https://evil.example/nodes')).toBeNull();
    expect(sanitizeReturnTo('//evil.example/nodes')).toBeNull();
    expect(sanitizeReturnTo('/\\evil.example')).toBeNull();
    expect(sanitizeReturnTo('nodes')).toBeNull();
    expect(sanitizeReturnTo('')).toBeNull();
    expect(sanitizeReturnTo(null)).toBeNull();
  });
});

describe('destinationFromLocation', () => {
  it('prefers state.from, then ?next=, then the current URL', () => {
    expect(destinationFromLocation({
      pathname: '/nodes',
      search: '',
      state: { from: '/reports/abc' },
    })).toBe('/reports/abc');

    expect(destinationFromLocation({
      pathname: '/nodes',
      search: '',
      state: { from: { pathname: '/insights', search: '?pane=1', hash: '' } },
    })).toBe('/insights?pane=1');

    expect(destinationFromLocation({
      pathname: '/',
      search: '?next=/orchestration',
    })).toBe('/orchestration');

    expect(destinationFromLocation({
      pathname: '/',
      search: '?next=https://evil.example',
    })).toBe('/');

    expect(destinationFromLocation({
      pathname: '/nodes',
      search: '?next=https://evil.example&status=failed',
    })).toBe('/nodes?status=failed');

    expect(destinationFromLocation({
      pathname: '/nodes/web',
      search: '?status=failed',
      hash: '#facts',
    })).toBe('/nodes/web?status=failed#facts');
  });

  it('ignores an unsafe state.from and falls through', () => {
    expect(destinationFromLocation({
      pathname: '/certificates',
      state: { from: 'https://evil.example' },
    })).toBe('/certificates');
  });
});

describe('rememberReturnTo', () => {
  it('round-trips a deep link and clears the dashboard root', () => {
    rememberReturnTo('/deployment?env=production');
    expect(peekReturnTo()).toBe('/deployment?env=production');
    expect(consumeReturnTo()).toBe('/deployment?env=production');
    expect(peekReturnTo()).toBeNull();

    rememberReturnTo('/installer');
    rememberReturnTo('/');
    expect(peekReturnTo()).toBeNull();

    rememberReturnTo('https://evil.example');
    expect(peekReturnTo()).toBeNull();
  });
});

describe('resolvePostLoginDestination', () => {
  it('keeps the live deep link and uses the saved path only from /', () => {
    expect(resolvePostLoginDestination('/nodes/a', '/orchestration')).toBe('/nodes/a');
    expect(resolvePostLoginDestination('/', '/reports')).toBe('/reports');
    expect(resolvePostLoginDestination('/', null)).toBe('/');
    expect(resolvePostLoginDestination('/', 'https://evil.example')).toBe('/');
  });
});
