import { describe, it, expect, vi } from 'vitest';
import { DriveClient, LATEST_NAME } from '../../worker/src/drive';

const config = { clientId: 'c', clientSecret: 's', refreshToken: 'r' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('DriveClient request shapes', () => {
  it('embeds appProperties (revision/deviceId/savedAt) in the upload metadata', async () => {
    let uploadBody = '';
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('token')) return jsonResponse({ access_token: 't' });
      if (url.includes('mimeType')) return jsonResponse({ files: [{ id: 'folder-1' }] });
      if (url.includes('/upload/')) {
        uploadBody = String(init?.body ?? '');
        return jsonResponse({ id: 'x', name: LATEST_NAME });
      }
      return jsonResponse({ files: [] });
    });
    const drive = new DriveClient(config, fetchImpl as unknown as typeof fetch);
    await drive.putLatest('{"content":true}', {
      revision: 12,
      deviceId: 'dev-9',
      savedAt: '2026-07-02T14:00:00Z',
    });
    expect(uploadBody).toContain('"revision":"12"');
    expect(uploadBody).toContain('"deviceId":"dev-9"');
    expect(uploadBody).toContain('"content":true'); // the media part
    expect(uploadBody).toContain(`"name":"${LATEST_NAME}"`);
  });

  it('sends the bearer token on list requests', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input).includes('token')) return jsonResponse({ access_token: 'abc' });
      return jsonResponse({ files: [] });
    });
    const drive = new DriveClient(config, fetchImpl as unknown as typeof fetch);
    await drive.listBackups();
    const listCall = fetchImpl.mock.calls.find((c) =>
      String(c[0]).includes('/drive/v3/files'),
    );
    const headers = (listCall![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer abc');
  });

  it('listTimestamped excludes the latest pointer', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('token')) return jsonResponse({ access_token: 't' });
      return jsonResponse({
        files: [
          { id: 'l', name: LATEST_NAME, createdTime: 'x' },
          { id: 't1', name: 'family-tree-2026-07-01.json', createdTime: 'x' },
          { id: 't2', name: 'family-tree-2026-06-01.json', createdTime: 'x' },
        ],
      });
    });
    const drive = new DriveClient(config, fetchImpl as unknown as typeof fetch);
    const ts = await drive.listTimestamped();
    expect(ts.map((f) => f.id).sort()).toEqual(['t1', 't2']);
  });

  it('throws a clear error when upload fails', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('token')) return jsonResponse({ access_token: 't' });
      if (String(input).includes('mimeType')) return jsonResponse({ files: [{ id: 'folder-1' }] });
      if (String(input).includes('/upload/')) return new Response('boom', { status: 500 });
      return jsonResponse({ files: [] });
    });
    const drive = new DriveClient(config, fetchImpl as unknown as typeof fetch);
    await expect(
      drive.putLatest('{}', { revision: 1, deviceId: 'd', savedAt: 's' }),
    ).rejects.toThrow(/Drive upload failed/);
  });
});
