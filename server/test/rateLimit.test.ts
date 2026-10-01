import { afterEach, describe, expect, it, vi } from 'vitest';
import { allow, forget } from '../src/lib/rateLimit';

afterEach(() => vi.useRealTimers());

describe('rate limits', () => {
  it('allows up to the limit, then refuses', () => {
    const results = Array.from({ length: 4 }, () => allow('t:basic', 3));
    expect(results).toEqual([true, true, true, false]);
  });

  it('keeps separate counts per key', () => {
    expect(allow('t:a', 1)).toBe(true);
    expect(allow('t:a', 1)).toBe(false);
    expect(allow('t:b', 1)).toBe(true);
  });

  it('allows again once the window has passed', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    expect(allow('t:window', 2, 60_000)).toBe(true);
    expect(allow('t:window', 2, 60_000)).toBe(true);
    expect(allow('t:window', 2, 60_000)).toBe(false);
    vi.setSystemTime(Date.now() + 61_000);
    expect(allow('t:window', 2, 60_000)).toBe(true);
  });

  it('does not count refused attempts against later ones', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    allow('t:refused', 1, 60_000);
    for (let i = 0; i < 5; i++) allow('t:refused', 1, 60_000);
    vi.setSystemTime(Date.now() + 61_000);
    expect(allow('t:refused', 1, 60_000)).toBe(true);
  });

  it('starts afresh after forget (e.g. a successful sign-in)', () => {
    allow('t:forget', 1);
    expect(allow('t:forget', 1)).toBe(false);
    forget('t:forget');
    expect(allow('t:forget', 1)).toBe(true);
  });
});
