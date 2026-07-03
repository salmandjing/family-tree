import { describe, it, expect, vi } from 'vitest';
import { HttpWorkerApi } from '@/sync/workerApi';

function res(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('HttpWorkerApi', () => {
  it('sends the passphrase as a bearer token on /latest', async () => {
    const fetchImpl = vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) =>
      res({ meta: { revision: 1 } }),
    );
    const api = new HttpWorkerApi('https://api/', 'pw', fetchImpl as unknown as typeof fetch);
    await api.latestMeta();
    const [, init] = fetchImpl.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer pw' });
  });

  it('maps 401 to a friendly error', async () => {
    const fetchImpl = vi.fn(async () => res({ error: 'Unauthorized' }, 401));
    const api = new HttpWorkerApi('https://api', 'bad', fetchImpl as unknown as typeof fetch);
    await expect(api.latestMeta()).rejects.toThrow(/passphrase/i);
  });

  it('maps 429 to a wait error on backup', async () => {
    const fetchImpl = vi.fn(async () => res({ error: 'slow down' }, 429));
    const api = new HttpWorkerApi('https://api', 'pw', fetchImpl as unknown as typeof fetch);
    await expect(
      api.backup('{}', { revision: 1, deviceId: 'd', savedAt: 's' }),
    ).rejects.toThrow(/Too many/);
  });

  it('reads health without auth', async () => {
    const fetchImpl = vi.fn(async () =>
      res({ ok: true, lastBackupAt: 'x', lastBackupRevision: 3 }),
    );
    const api = new HttpWorkerApi('https://api', 'pw', fetchImpl as unknown as typeof fetch);
    const h = await api.health();
    expect(h.lastBackupRevision).toBe(3);
  });

  it('posts content+meta on backup', async () => {
    const fetchImpl = vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) =>
      res({ revision: 9 }),
    );
    const api = new HttpWorkerApi('https://api', 'pw', fetchImpl as unknown as typeof fetch);
    const out = await api.backup('{"a":1}', { revision: 9, deviceId: 'd', savedAt: 's' });
    expect(out.revision).toBe(9);
    const [, init] = fetchImpl.mock.calls[0];
    expect((init as RequestInit).method).toBe('PUT');
    expect(JSON.parse((init as RequestInit).body as string).meta.revision).toBe(9);
  });
});
