import { describe, it, expect, beforeAll } from 'vitest';
import { handleRequest, type Env, type Deps } from '../../worker/src/index';
import { sha256Hex } from '../../worker/src/auth';
import type { DriveClient, TreeMeta, DriveFileMeta } from '../../worker/src/drive';

const PASSPHRASE = 'family secret';
let env: Env;

beforeAll(async () => {
  env = {
    PASSPHRASE_HASH: await sha256Hex(PASSPHRASE),
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_REFRESH_TOKEN: 'refresh',
    ALLOWED_ORIGIN: '*',
  };
});

/** A stand-in Drive that records interactions, injected via Deps. */
class FakeDrive {
  latest: { content: string; meta: TreeMeta } | null = null;
  timestamped: DriveFileMeta[] = [];
  deleted: string[] = [];

  constructor(seedMeta?: TreeMeta, seedContent = '{}') {
    if (seedMeta) this.latest = { content: seedContent, meta: seedMeta };
  }
  async latestMeta(): Promise<TreeMeta | null> {
    return this.latest?.meta ?? null;
  }
  async downloadLatest(): Promise<string | null> {
    return this.latest?.content ?? null;
  }
  async putLatest(content: string, meta: TreeMeta) {
    this.latest = { content, meta };
    return { id: 'latest', name: 'family-tree-latest.json', createdTime: 'x' };
  }
  async putTimestamped(_c: string, meta: TreeMeta, ts: string) {
    const f = {
      id: `ts-${this.timestamped.length}`,
      name: `family-tree-${ts}.json`,
      createdTime: ts,
      appProperties: { savedAt: meta.savedAt },
    };
    this.timestamped.push(f);
    return f;
  }
  async listTimestamped() {
    return this.timestamped;
  }
  async deleteFile(id: string) {
    this.deleted.push(id);
  }
}

function depsWith(fake: FakeDrive, now = 0): Deps {
  return {
    makeDrive: () => fake as unknown as DriveClient,
    now: () => now,
  };
}

function req(
  path: string,
  init: RequestInit & { ip?: string } = {},
): Request {
  const { ip = '10.0.0.1', headers, ...rest } = init;
  return new Request(`https://api.example.com${path}`, {
    ...rest,
    headers: { 'CF-Connecting-IP': ip, ...(headers as Record<string, string>) },
  });
}

const authHeader = { Authorization: `Bearer ${PASSPHRASE}` };

describe('GET /health (no auth)', () => {
  it('reports last backup metadata', async () => {
    const fake = new FakeDrive({
      revision: 7,
      deviceId: 'd',
      savedAt: '2026-07-02T14:00:00Z',
    });
    const res = await handleRequest(req('/health', { ip: 'h1' }), env, depsWith(fake));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, lastBackupRevision: 7 });
  });

  it('returns nulls when nothing is backed up', async () => {
    const res = await handleRequest(
      req('/health', { ip: 'h2' }),
      env,
      depsWith(new FakeDrive()),
    );
    const body = await res.json();
    expect(body.lastBackupAt).toBeNull();
  });
});

describe('auth enforcement', () => {
  it('rejects /latest without a passphrase', async () => {
    const res = await handleRequest(
      req('/latest', { ip: 'a1' }),
      env,
      depsWith(new FakeDrive()),
    );
    expect(res.status).toBe(401);
  });

  it('rejects a wrong passphrase', async () => {
    const res = await handleRequest(
      req('/latest', { ip: 'a2', headers: { Authorization: 'Bearer nope' } }),
      env,
      depsWith(new FakeDrive()),
    );
    expect(res.status).toBe(401);
  });
});

describe('GET /latest', () => {
  it('returns metadata only by default', async () => {
    const fake = new FakeDrive({ revision: 3, deviceId: 'd', savedAt: 's' });
    const res = await handleRequest(
      req('/latest', { ip: 'l1', headers: authHeader }),
      env,
      depsWith(fake),
    );
    const body = await res.json();
    expect(body.meta.revision).toBe(3);
    expect(body.content).toBeUndefined();
  });

  it('includes content when ?content=1', async () => {
    const fake = new FakeDrive(
      { revision: 3, deviceId: 'd', savedAt: 's' },
      '{"persons":[]}',
    );
    const res = await handleRequest(
      req('/latest?content=1', { ip: 'l2', headers: authHeader }),
      env,
      depsWith(fake),
    );
    const body = await res.json();
    expect(body.content).toBe('{"persons":[]}');
  });

  it('returns meta:null when Drive is empty', async () => {
    const res = await handleRequest(
      req('/latest', { ip: 'l3', headers: authHeader }),
      env,
      depsWith(new FakeDrive()),
    );
    expect((await res.json()).meta).toBeNull();
  });
});

describe('PUT /backup', () => {
  const goodBody = JSON.stringify({
    content: '{"revision":5}',
    meta: { revision: 5, deviceId: 'd', savedAt: '2026-07-02T14:00:00Z' },
  });

  it('writes latest + timestamped and prunes', async () => {
    const fake = new FakeDrive();
    const res = await handleRequest(
      req('/backup', { ip: 'b1', method: 'PUT', headers: authHeader, body: goodBody }),
      env,
      depsWith(fake),
    );
    expect(res.status).toBe(200);
    expect(fake.latest?.meta.revision).toBe(5);
    expect(fake.timestamped).toHaveLength(1);
  });

  it('rejects a malformed payload', async () => {
    const res = await handleRequest(
      req('/backup', {
        ip: 'b2',
        method: 'PUT',
        headers: authHeader,
        body: JSON.stringify({ nope: true }),
      }),
      env,
      depsWith(new FakeDrive()),
    );
    expect(res.status).toBe(400);
  });

  it('rejects non-JSON body', async () => {
    const res = await handleRequest(
      req('/backup', { ip: 'b3', method: 'PUT', headers: authHeader, body: '{bad' }),
      env,
      depsWith(new FakeDrive()),
    );
    expect(res.status).toBe(400);
  });
});

describe('rate limiting', () => {
  it('returns 429 after too many attempts from one IP', async () => {
    const fake = new FakeDrive();
    let last: Response | null = null;
    for (let i = 0; i < 12; i++) {
      last = await handleRequest(
        req('/latest', { ip: 'flooder', headers: { Authorization: 'Bearer x' } }),
        env,
        depsWith(fake, 0),
      );
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get('Retry-After')).toBeTruthy();
  });
});

describe('CORS + routing', () => {
  it('answers preflight OPTIONS', async () => {
    const res = await handleRequest(
      req('/backup', { ip: 'c1', method: 'OPTIONS' }),
      env,
      depsWith(new FakeDrive()),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
  });

  it('404s unknown routes', async () => {
    const res = await handleRequest(
      req('/nope', { ip: 'c2', headers: authHeader }),
      env,
      depsWith(new FakeDrive()),
    );
    expect(res.status).toBe(404);
  });
});
