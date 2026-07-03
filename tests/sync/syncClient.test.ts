import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalStore } from '@/store/localStore';
import { TreeService } from '@/app/treeService';
import { SyncClient } from '@/sync/syncClient';
import type { WorkerApi, HealthResponse, LatestResponse } from '@/sync/workerApi';
import type { TreeMeta } from '@/sync/types';
import { addPerson } from '@/core/operations';
import type { Compressor } from '@/app/photoService';

const passthrough: Compressor = async (f) => f;
const clock = () => new Date('2026-07-02T14:00:00Z');

/** In-memory fake Worker backed by a single "drive" slot. */
class FakeApi implements WorkerApi {
  drive: { content: string; meta: TreeMeta } | null = null;
  backupCalls = 0;

  constructor(seed?: { content: string; meta: TreeMeta }) {
    this.drive = seed ?? null;
  }
  async health(): Promise<HealthResponse> {
    return {
      ok: true,
      lastBackupAt: this.drive?.meta.savedAt ?? null,
      lastBackupRevision: this.drive?.meta.revision ?? null,
    };
  }
  async latestMeta(): Promise<TreeMeta | null> {
    return this.drive?.meta ?? null;
  }
  async latestWithContent(): Promise<LatestResponse> {
    return { meta: this.drive?.meta ?? null, content: this.drive?.content };
  }
  async backup(content: string, meta: TreeMeta): Promise<{ revision: number }> {
    this.backupCalls++;
    this.drive = { content, meta };
    return { revision: meta.revision };
  }
}

let store: LocalStore;
let service: TreeService;
let dbn = 0;

async function freshService(deviceId: string) {
  const s = await LocalStore.open(`sync-db-${dbn++}`);
  const svc = new TreeService({ store: s, deviceId, compressor: passthrough, clock });
  await svc.init();
  return { s, svc };
}

beforeEach(async () => {
  const f = await freshService('device-A');
  store = f.s;
  service = f.svc;
});

afterEach(() => {
  service.dispose();
});

function makeClient(api: WorkerApi, overrides = {}) {
  return new SyncClient({
    service,
    store,
    api,
    deviceId: 'device-A',
    now: clock,
    ...overrides,
  });
}

describe('evaluate — first backup', () => {
  it('backs up when local has data and Drive is empty', async () => {
    await service.apply((t, c) => addPerson(t, { given: 'A' }, c).tree);
    const api = new FakeApi();
    const client = makeClient(api);
    const decision = await client.evaluate();
    expect(decision.action).toBe('backup');
    expect(api.drive).not.toBeNull();
    expect(client.getStatus().state).toBe('idle');
  });

  it('stays in-sync when both empty', async () => {
    const api = new FakeApi();
    const decision = await makeClient(api).evaluate();
    expect(decision.action).toBe('in-sync');
  });
});

describe('evaluate — restore on fresh device', () => {
  it('restores Drive content when local is empty', async () => {
    // Build a donor tree and serialize it as the drive content.
    const donor = await freshService('device-B');
    await donor.svc.apply((t, c) => addPerson(t, { given: 'FromDrive' }, c).tree);
    const content = await donor.svc.exportJson(false);
    const meta: TreeMeta = {
      revision: donor.svc.getTree().revision,
      deviceId: 'device-B',
      savedAt: '2026-07-01T00:00:00Z',
    };
    donor.svc.dispose();

    const api = new FakeApi({ content, meta });
    const client = makeClient(api);
    const decision = await client.evaluate();
    expect(decision.action).toBe('restore');
    expect(service.getTree().persons.map((p) => p.name.given)).toContain('FromDrive');
  });
});

describe('evaluate — conflict', () => {
  it('surfaces a conflict when both changed since last sync', async () => {
    // Local has data and a marker; Drive moved independently.
    await service.apply((t, c) => addPerson(t, { given: 'Local' }, c).tree);
    await store.setMeta('sync.lastSynced', {
      syncedLocalRevision: 1,
      syncedDriveRevision: 50,
    });
    // Local now at revision 2 (moved), Drive at 99 (moved).
    await service.apply((t, c) => addPerson(t, { given: 'Local2' }, c).tree);

    const api = new FakeApi({
      content: '{}',
      meta: { revision: 99, deviceId: 'device-B', savedAt: '2026-07-02T13:00:00Z' },
    });
    let conflictSeen = false;
    const client = makeClient(api, { onConflict: () => (conflictSeen = true) });
    const decision = await client.evaluate();
    expect(decision.action).toBe('conflict');
    expect(conflictSeen).toBe(true);
    expect(client.getPendingConflict()).not.toBeNull();
  });
});

describe('resolveConflict', () => {
  async function setupConflict() {
    await service.apply((t, c) => addPerson(t, { given: 'Local' }, c).tree);
    const donor = await freshService('device-B');
    await donor.svc.apply((t, c) => addPerson(t, { given: 'Remote' }, c).tree);
    const content = await donor.svc.exportJson(false);
    const meta: TreeMeta = {
      revision: 77,
      deviceId: 'device-B',
      savedAt: '2026-07-02T13:00:00Z',
    };
    donor.svc.dispose();
    return new FakeApi({ content, meta });
  }

  it("'local' backs up the local version", async () => {
    const api = await setupConflict();
    const client = makeClient(api);
    await client.resolveConflict('local');
    expect(api.backupCalls).toBe(1);
    expect(service.getTree().persons.map((p) => p.name.given)).toContain('Local');
    expect(client.getPendingConflict()).toBeNull();
  });

  it("'remote' restores the Drive version", async () => {
    const api = await setupConflict();
    const client = makeClient(api);
    await client.resolveConflict('remote');
    expect(service.getTree().persons.map((p) => p.name.given)).toContain('Remote');
  });

  it("'both' keeps local and returns the other version to download", async () => {
    const api = await setupConflict();
    const client = makeClient(api);
    const res = await client.resolveConflict('both');
    expect(service.getTree().persons.map((p) => p.name.given)).toContain('Local');
    expect(res.downloadJson).toBeTruthy();
    expect(res.downloadName).toMatch(/other-version/);
  });
});

describe('status on network failure', () => {
  it('marks offline on a network error', async () => {
    const api: WorkerApi = {
      health: async () => ({ ok: false, lastBackupAt: null, lastBackupRevision: null }),
      latestMeta: async () => {
        throw new Error('Failed to fetch');
      },
      latestWithContent: async () => ({ meta: null }),
      backup: async () => ({ revision: 0 }),
    };
    const client = makeClient(api);
    await client.evaluate();
    expect(client.getStatus().state).toBe('offline');
  });

  it('marks error on a non-network failure', async () => {
    const api: WorkerApi = {
      health: async () => ({ ok: false, lastBackupAt: null, lastBackupRevision: null }),
      latestMeta: async () => {
        throw new Error('Wrong passphrase');
      },
      latestWithContent: async () => ({ meta: null }),
      backup: async () => ({ revision: 0 }),
    };
    const client = makeClient(api);
    await client.evaluate();
    expect(client.getStatus().state).toBe('error');
  });
});
