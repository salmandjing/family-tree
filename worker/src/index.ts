/**
 * Cloudflare Worker — the backup service (spec §2, §6, §7, §8). It is the only
 * component holding secrets (Google OAuth + passphrase hash). Endpoints:
 *
 *   GET  /health   → { ok, lastBackupAt, lastBackupRevision }   (no auth)
 *   GET  /latest   → { meta } or { meta, content }              (auth)
 *   PUT  /backup   → writes latest + timestamped, prunes         (auth)
 *
 * Real enforcement lives here; the frontend gate is cosmetic (spec §7).
 */

import { verifyPassphrase, extractBearer } from './auth';
import { RateLimiter, clientIp } from './rateLimit';
import { DriveClient, type TreeMeta } from './drive';
import { selectForPrune } from './prune';

export interface Env {
  PASSPHRASE_HASH: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REFRESH_TOKEN: string;
  /** Comma-separated allowlist of page origins (CORS). '*' allows any. */
  ALLOWED_ORIGIN?: string;
}

// Per-isolate limiter: 10 attempts / minute / IP (spec §7).
const limiter = new RateLimiter(10, 60_000);

/**
 * CORS headers. ALLOWED_ORIGIN is a comma-separated allowlist; the request's
 * Origin is echoed back when it matches (so more than one site can use the same
 * Worker). Auth is via Bearer token, not cookies, so this is a convenience/
 * hygiene control rather than the security boundary.
 */
function corsHeaders(env: Env, request: Request): Record<string, string> {
  const allow = (env.ALLOWED_ORIGIN ?? '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = request.headers.get('Origin') ?? '';
  const allowOrigin = allow.includes('*')
    ? '*'
    : allow.includes(origin)
      ? origin
      : (allow[0] ?? '*');
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export interface BackupRequestBody {
  content: string; // the full serialized tree JSON
  meta: TreeMeta; // revision/deviceId/savedAt
}

export interface Deps {
  makeDrive: (env: Env) => DriveClient;
  now: () => number;
}

const defaultDeps: Deps = {
  makeDrive: (env) =>
    new DriveClient({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      refreshToken: env.GOOGLE_REFRESH_TOKEN,
    }),
  now: () => Date.now(),
};

export async function handleRequest(
  request: Request,
  env: Env,
  deps: Deps = defaultDeps,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  const cors = corsHeaders(env, request);
  const json = (
    body: unknown,
    status: number,
    extra: Record<string, string> = {},
  ): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...cors, ...extra },
    });

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  // ── Health: unauthenticated, cheap (spec §8) ────────────────────────────
  if (path === '/health' && request.method === 'GET') {
    try {
      const drive = deps.makeDrive(env);
      const meta = await drive.latestMeta();
      return json({
        ok: true,
        lastBackupAt: meta?.savedAt ?? null,
        lastBackupRevision: meta?.revision ?? null,
      }, 200);
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, 502);
    }
  }

  // ── Everything else requires the passphrase ─────────────────────────────
  const ip = clientIp(request);
  const rl = limiter.check(ip, deps.now());
  if (!rl.allowed) {
    return json({ error: 'Too many attempts. Please wait.' }, 429, {
      'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)),
    });
  }

  const token = extractBearer(request);
  if (!token || !(await verifyPassphrase(token, env.PASSPHRASE_HASH))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const drive = deps.makeDrive(env);

  // ── GET /latest: metadata (and optionally content) ──────────────────────
  if (path === '/latest' && request.method === 'GET') {
    try {
      const meta = await drive.latestMeta();
      if (!meta) return json({ meta: null }, 200);
      if (url.searchParams.get('content') === '1') {
        const content = await drive.downloadLatest();
        return json({ meta, content }, 200);
      }
      return json({ meta }, 200);
    } catch (e) {
      return json({ error: (e as Error).message }, 502);
    }
  }

  // ── PUT /backup: write latest + timestamped, then prune ─────────────────
  if (path === '/backup' && request.method === 'PUT') {
    let payload: BackupRequestBody;
    try {
      payload = (await request.json()) as BackupRequestBody;
    } catch {
      return json({ error: 'Body must be JSON' }, 400);
    }
    if (
      !payload ||
      typeof payload.content !== 'string' ||
      !payload.meta ||
      typeof payload.meta.revision !== 'number' ||
      typeof payload.meta.deviceId !== 'string'
    ) {
      return json({ error: 'Invalid backup payload' }, 400);
    }

    try {
      await drive.putLatest(payload.content, payload.meta);
      await drive.putTimestamped(payload.content, payload.meta, payload.meta.savedAt);

      // Prune timestamped copies per policy (spec §5).
      const timestamped = await drive.listTimestamped();
      const plan = selectForPrune(
        timestamped.map((f) => ({
          id: f.id,
          timestamp: f.appProperties?.savedAt ?? f.createdTime,
        })),
      );
      for (const id of plan.delete) await drive.deleteFile(id);

      return json({
        ok: true,
        revision: payload.meta.revision,
        pruned: plan.delete.length,
      }, 200);
    } catch (e) {
      return json({ error: (e as Error).message }, 502);
    }
  }

  return json({ error: 'Not found' }, 404);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
