/**
 * Sliding-window rate limiter (spec §7: limit auth attempts, e.g. 10/min/IP to
 * prevent brute force). Pure and injectable: the caller supplies the timestamp
 * store (a Map in the Worker isolate, or a fake in tests) and the current time.
 *
 * Note: a per-isolate Map is best-effort on Workers (multiple isolates exist),
 * which is acceptable for slowing brute force. A stricter limiter would use a
 * Durable Object or KV; see README for the upgrade path.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export class RateLimiter {
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly hits: Map<string, number[]> = new Map(),
  ) {}

  /** Record an attempt for `key` at time `now` and report whether it's allowed. */
  check(key: string, now: number): RateLimitResult {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);

    if (recent.length >= this.limit) {
      const oldest = recent[0];
      this.hits.set(key, recent);
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, oldest + this.windowMs - now),
      };
    }

    recent.push(now);
    this.hits.set(key, recent);
    return {
      allowed: true,
      remaining: this.limit - recent.length,
      retryAfterMs: 0,
    };
  }

  /** Drop stale keys to bound memory (call opportunistically). */
  sweep(now: number): void {
    const cutoff = now - this.windowMs;
    for (const [key, times] of this.hits) {
      const recent = times.filter((t) => t > cutoff);
      if (recent.length === 0) this.hits.delete(key);
      else this.hits.set(key, recent);
    }
  }
}

/**
 * Client IP for rate-limit keying. Only CF-Connecting-IP is trusted — it is set
 * by Cloudflare and cannot be spoofed by the client. We deliberately do NOT fall
 * back to X-Forwarded-For (client-controllable), which would let an attacker mint
 * unlimited fresh rate-limit buckets.
 */
export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}
