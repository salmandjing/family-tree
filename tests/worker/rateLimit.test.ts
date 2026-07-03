import { describe, it, expect } from 'vitest';
import { RateLimiter, clientIp } from '../../worker/src/rateLimit';

describe('RateLimiter', () => {
  it('allows up to the limit then blocks within the window', () => {
    const rl = new RateLimiter(3, 1000);
    expect(rl.check('ip', 0).allowed).toBe(true);
    expect(rl.check('ip', 10).allowed).toBe(true);
    expect(rl.check('ip', 20).allowed).toBe(true);
    const blocked = rl.check('ip', 30);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('lets attempts through again after the window slides', () => {
    const rl = new RateLimiter(2, 1000);
    rl.check('ip', 0);
    rl.check('ip', 100);
    expect(rl.check('ip', 200).allowed).toBe(false);
    // After the first hit ages out (>1000ms since t=0):
    expect(rl.check('ip', 1101).allowed).toBe(true);
  });

  it('tracks separate keys independently', () => {
    const rl = new RateLimiter(1, 1000);
    expect(rl.check('a', 0).allowed).toBe(true);
    expect(rl.check('b', 0).allowed).toBe(true);
    expect(rl.check('a', 0).allowed).toBe(false);
  });

  it('sweep drops stale keys', () => {
    const hits = new Map<string, number[]>();
    const rl = new RateLimiter(1, 1000, hits);
    rl.check('a', 0);
    rl.sweep(2000);
    expect(hits.has('a')).toBe(false);
  });
});

describe('clientIp', () => {
  it('prefers CF-Connecting-IP', () => {
    const req = new Request('https://x', {
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    });
    expect(clientIp(req)).toBe('1.2.3.4');
  });
  it('falls back to unknown', () => {
    expect(clientIp(new Request('https://x'))).toBe('unknown');
  });
});
