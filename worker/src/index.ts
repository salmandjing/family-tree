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
  ALLOWED_ORIGIN?: string;
}

// Per-isolate limiter: 10 attempts / minute / IP (spec §7).
const limiter = new RateLimiter(10, 60_000);

function corsHeaders(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN ?? '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(
  body: unknown,
  status: number,
  env: Env,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env), ...extra },
  });
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

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(env) });
  }

  // ── Health: unauthenticated, cheap (spec §8) ────────────────────────────
  if (path === '/health' && request.method === 'GET') {
    try {
      const drive = deps.makeDrive(env);
      const meta = await drive.latestMeta();
      return json(
        {
          ok: true,
          lastBackupAt: meta?.savedAt ?? null,
          lastBackupRevision: meta?.revision ?? null,
        },
        200,
        env,
      );
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, 502, env);
    }
  }

  // ── Everything else requires the passphrase ─────────────────────────────
  const ip = clientIp(request);
  const rl = limiter.check(ip, deps.now());
  if (!rl.allowed) {
    return json({ error: 'Too many attempts. Please wait.' }, 429, env, {
      'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)),
    });
  }

  const token = extractBearer(request);
  if (!token || !(await verifyPassphrase(token, env.PASSPHRASE_HASH))) {
    return json({ error: 'Unauthorized' }, 401, env);
  }

  const drive = deps.makeDrive(env);

  // ── GET /latest: metadata (and optionally content) ──────────────────────
  if (path === '/latest' && request.method === 'GET') {
    try {
      const meta = await drive.latestMeta();
      if (!meta) return json({ meta: null }, 200, env);
      if (url.searchParams.get('content') === '1') {
        const content = await drive.downloadLatest();
        return json({ meta, content }, 200, env);
      }
      return json({ meta }, 200, env);
    } catch (e) {
      return json({ error: (e as Error).message }, 502, env);
    }
  }

  // ── PUT /backup: write latest + timestamped, then prune ─────────────────
  if (path === '/backup' && request.method === 'PUT') {
    let payload: BackupRequestBody;
    try {
      payload = (await request.json()) as BackupRequestBody;
    } catch {
      return json({ error: 'Body must be JSON' }, 400, env);
    }
    if (
      !payload ||
      typeof payload.content !== 'string' ||
      !payload.meta ||
      typeof payload.meta.revision !== 'number' ||
      typeof payload.meta.deviceId !== 'string'
    ) {
      return json({ error: 'Invalid backup payload' }, 400, env);
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

      return json(
        { ok: true, revision: payload.meta.revision, pruned: plan.delete.length },
        200,
        env,
      );
    } catch (e) {
      return json({ error: (e as Error).message }, 502, env);
    }
  }

  return json({ error: 'Not found' }, 404, env);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
