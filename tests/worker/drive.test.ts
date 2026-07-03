import { describe, it, expect, vi } from 'vitest';
import { DriveClient, LATEST_NAME } from '../../worker/src/drive';

const config = {
  clientId: 'cid',
  clientSecret: 'secret',
  refreshToken: 'refresh',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Build a fetch mock that dispatches by URL substring. */
function mockFetch(routes: {
  token?: unknown;
  files?: unknown;
  media?: string;
  upload?: unknown;
  del?: () => void;
}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('oauth2.googleapis.com/token')) {
      return jsonResponse(routes.token ?? { access_token: 'ya29.token' });
    }
    if (url.includes('/upload/drive/v3/files')) {
      return jsonResponse(routes.upload ?? { id: 'uploaded', name: 'x' });
    }
    if (url.includes('alt=media')) {
      return new Response(routes.media ?? '{}', { status: 200 });
    }
    if (url.includes('/drive/v3/files/') && method === 'DELETE') {
      routes.del?.();
      return new Response(null, { status: 204 });
    }
    if (url.includes('/drive/v3/files')) {
      return jsonResponse(routes.files ?? { files: [] });
    }
    return new Response('not found', { status: 404 });
  });
}

describe('DriveClient auth', () => {
  it('obtains and reuses an access token', async () => {
    const fetchImpl = mockFetch({});
    const drive = new DriveClient(config, fetchImpl as unknown as typeof fetch);
    await drive.listBackups();
    await drive.listBackups();
    const tokenCalls = fetchImpl.mock.calls.filter((c) =>
      String(c[0]).includes('token'),
    );
    expect(tokenCalls).toHaveLength(1); // cached
  });

  it('throws when auth fails', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('token')) return new Response('nope', { status: 400 });
      return jsonResponse({ files: [] });
    });
    const drive = new DriveClient(config, fetchImpl as unknown as typeof fetch);
    await expect(drive.listBackups()).rejects.toThrow(/Drive auth failed/);
  });
});

describe('DriveClient reads', () => {
  it('finds the latest pointer and reads its metadata', async () => {
    const fetchImpl = mockFetch({
      files: {
        files: [
          {
            id: 'latest-id',
            name: LATEST_NAME,
            createdTime: '2026-07-02T14:00:00Z',
            appProperties: {
              revision: '42',
              deviceId: 'dev-1',
              savedAt: '2026-07-02T14:00:00Z',
            },
          },
        ],
      },
    });
    const drive = new DriveClient(config, fetchImpl as unknown as typeof fetch);
    const meta = await drive.latestMeta();
    expect(meta).toEqual({
      revision: 42,
      deviceId: 'dev-1',
      savedAt: '2026-07-02T14:00:00Z',
    });
  });

  it('returns null metadata when no latest exists', async () => {
    const drive = new DriveClient(
      config,
      mockFetch({ files: { files: [] } }) as unknown as typeof fetch,
    );
    expect(await drive.latestMeta()).toBeNull();
  });

  it('downloads latest content', async () => {
    const fetchImpl = mockFetch({
      files: { files: [{ id: 'l', name: LATEST_NAME, createdTime: 'x' }] },
      media: '{"hello":"world"}',
    });
    const drive = new DriveClient(config, fetchImpl as unknown as typeof fetch);
    expect(await drive.downloadLatest()).toBe('{"hello":"world"}');
  });
});

describe('DriveClient writes', () => {
  it('creates latest when none exists (POST)', async () => {
    const fetchImpl = mockFetch({
      files: { files: [] },
      upload: { id: 'new-latest', name: LATEST_NAME },
    });
    const drive = new DriveClient(config, fetchImpl as unknown as typeof fetch);
    const res = await drive.putLatest('{"t":1}', {
      revision: 1,
      deviceId: 'd',
      savedAt: '2026-07-02T14:00:00Z',
    });
    expect(res.id).toBe('new-latest');
    const uploadCall = fetchImpl.mock.calls.find((c) =>
      String(c[0]).includes('/upload/'),
    );
    expect((uploadCall![1] as RequestInit).method).toBe('POST');
  });

  it('updates latest when it exists (PATCH)', async () => {
    const fetchImpl = mockFetch({
      files: { files: [{ id: 'existing', name: LATEST_NAME, createdTime: 'x' }] },
      upload: { id: 'existing', name: LATEST_NAME },
    });
    const drive = new DriveClient(config, fetchImpl as unknown as typeof fetch);
    await drive.putLatest('{"t":2}', {
      revision: 2,
      deviceId: 'd',
      savedAt: '2026-07-02T14:00:00Z',
    });
    const uploadCall = fetchImpl.mock.calls.find((c) =>
      String(c[0]).includes('/upload/'),
    );
    expect((uploadCall![1] as RequestInit).method).toBe('PATCH');
    expect(String(uploadCall![0])).toContain('existing');
  });

  it('writes a timestamped copy with a filesystem-safe name', async () => {
    const captured: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('token')) return jsonResponse({ access_token: 't' });
      if (url.includes('/upload/')) {
        captured.push(String((init?.body as string) ?? ''));
        return jsonResponse({ id: 'ts', name: 'x' });
      }
      return jsonResponse({ files: [] });
    });
    const drive = new DriveClient(config, fetchImpl as unknown as typeof fetch);
    await drive.putTimestamped('{}', { revision: 1, deviceId: 'd', savedAt: 'x' }, '2026-07-02T14:00:00.000Z');
    expect(captured[0]).toContain('family-tree-2026-07-02T14-00-00.json');
  });

  it('ignores 404 on delete', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('token')) return jsonResponse({ access_token: 't' });
      if (init?.method === 'DELETE') return new Response(null, { status: 404 });
      return jsonResponse({ files: [] });
    });
    const drive = new DriveClient(config, fetchImpl as unknown as typeof fetch);
    await expect(drive.deleteFile('gone')).resolves.toBeUndefined();
  });
});
