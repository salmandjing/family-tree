/**
 * Full-stack integration: build a tree with photos, back it up through a fake
 * Worker, restore it on a fresh "device", and assert the family survives byte
 * for byte (spec §11 export round-trip + new-device restore).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { LocalStore } from '@/store/localStore';
import { TreeService } from '@/app/treeService';
import { SyncClient } from '@/sync/syncClient';
import type { WorkerApi, HealthResponse, LatestResponse } from '@/sync/workerApi';
import type { TreeMeta } from '@/sync/types';
import { addPerson } from '@/core/operations';
import { addChild, addSpouse } from '@/core/relationships';
import type { Compressor } from '@/app/photoService';

const passthrough: Compressor = async (f) => f;
const clock = () => new Date('2026-07-02T14:00:00Z');

class FakeApi implements WorkerApi {
  drive: { content: string; meta: TreeMeta } | null = null;
  async health(): Promise<HealthResponse> {
    return {
      ok: true,
      lastBackupAt: this.drive?.meta.savedAt ?? null,
      lastBackupRevision: this.drive?.meta.revision ?? null,
    };
  }
  async latestMeta() {
    return this.drive?.meta ?? null;
  }
  async latestWithContent(): Promise<LatestResponse> {
    return { meta: this.drive?.meta ?? null, content: this.drive?.content };
  }
  async backup(content: string, meta: TreeMeta) {
    this.drive = { content, meta };
    return { revision: meta.revision };
  }
}

const services: TreeService[] = [];
let dbn = 0;

async function newService(deviceId: string) {
  const store = await LocalStore.open(`rt-db-${dbn++}`);
  const svc = new TreeService({ store, deviceId, compressor: passthrough, clock });
  await svc.init();
  services.push(svc);
  return { store, svc };
}

afterEach(() => {
  for (const s of services.splice(0)) s.dispose();
});

function photoBytes(): Uint8Array<ArrayBuffer> {
  const a = new Uint8Array(300);
  for (let i = 0; i < a.length; i++) a[i] = (i * 7) % 256;
  return a;
}

describe('backup → restore round trip', () => {
  it('reconstructs the whole family (incl. photo bytes) on a fresh device', async () => {
    const api = new FakeApi();

    // Device A builds a family with a photo.
    const a = await newService('device-A');
    let dadId = '';
    await a.svc.apply((t, c) => {
      const dad = addPerson(t, { given: 'Amadou', family: 'Diallo', sex: 'M' }, c);
      dadId = dad.person.id;
      const withMom = addSpouse(dad.tree, dad.person.id, { given: 'Fatou', sex: 'F' }, 'married', c);
      return addChild(withMom.tree, dad.person.id, { given: 'Aïssatou', sex: 'F' }, {}, c).tree;
    });
    const blob = new Blob([photoBytes()], { type: 'image/jpeg' });
    await a.svc.addPhoto(dadId, blob);

    const clientA = new SyncClient({
      service: a.svc,
      store: a.store,
      api,
      deviceId: 'device-A',
      now: clock,
    });
    await clientA.backupNow();
    expect(api.drive).not.toBeNull();

    // Device B (fresh) restores from Drive.
    const b = await newService('device-B');
    const clientB = new SyncClient({
      service: b.svc,
      store: b.store,
      api,
      deviceId: 'device-B',
      now: clock,
    });
    const decision = await clientB.evaluate();
    expect(decision.action).toBe('restore');

    const restored = b.svc.getTree();
    // People and unions match by content.
    expect(restored.persons.map((p) => p.name.given).sort()).toEqual(
      ['Amadou', 'Aïssatou', 'Fatou'].sort(),
    );
    expect(restored.unions).toHaveLength(1);
    expect(restored.photos).toHaveLength(1);

    // Photo bytes survived the base64 round trip.
    const restoredPhotoId = restored.photos[0].id;
    const storedBlob = await b.store.getPhotoBlob(restoredPhotoId);
    expect(storedBlob).not.toBeNull();
    const bytes = new Uint8Array(await storedBlob!.blob.arrayBuffer());
    expect(bytes).toEqual(photoBytes());

    // After restore, B is in sync (next evaluate does nothing).
    const second = await clientB.evaluate();
    expect(second.action).toBe('in-sync');
  });

  it('unicode and emoji names survive export/import', async () => {
    const a = await newService('device-A');
    await a.svc.apply((t, c) =>
      addPerson(t, { given: 'José 👨🏾', family: "N'Diaye — ﷽", nicknames: ['Père'] }, c).tree,
    );
    const json = await a.svc.exportJson();

    const b = await newService('device-B');
    const imported = await b.svc.importJson(json);
    const p = imported.persons[0];
    expect(p.name.given).toBe('José 👨🏾');
    expect(p.name.family).toBe("N'Diaye — ﷽");
    expect(p.name.nicknames).toEqual(['Père']);
  });

  it('a second backup overwrites latest and the marker keeps devices in sync', async () => {
    const api = new FakeApi();
    const a = await newService('device-A');
    const client = new SyncClient({
      service: a.svc,
      store: a.store,
      api,
      deviceId: 'device-A',
      now: clock,
    });

    await a.svc.apply((t, c) => addPerson(t, { given: 'One' }, c).tree);
    await client.backupNow();
    const firstRev = api.drive!.meta.revision;

    await a.svc.apply((t, c) => addPerson(t, { given: 'Two' }, c).tree);
    await client.backupNow();
    expect(api.drive!.meta.revision).toBeGreaterThan(firstRev);

    // Re-evaluating finds nothing to do.
    const decision = await client.evaluate();
    expect(decision.action).toBe('in-sync');
  });
});
