import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalStore } from '@/store/localStore';
import { MAX_SNAPSHOTS } from '@/store/schema';
import { createEmptyTree } from '@/core/factories';
import {
  addPerson,
  addPhotoRecord,
  softDeletePerson,
  getPerson,
  commit,
} from '@/core/operations';
import type { FamilyTree } from '@/core/types';

let store: LocalStore;
let dbCounter = 0;

beforeEach(async () => {
  // Fresh DB per test for isolation.
  store = await LocalStore.open(`test-db-${dbCounter++}`);
});

afterEach(() => {
  store.close();
});

function seed(): FamilyTree {
  const a = addPerson(createEmptyTree('device-A'), { given: 'Amina' });
  return a.tree;
}

describe('tree persistence', () => {
  it('returns null before anything is saved', async () => {
    expect(await store.loadTree()).toBeNull();
  });

  it('saves and loads the live tree', async () => {
    const tree = seed();
    await store.saveTree(tree);
    const loaded = await store.loadTree();
    expect(loaded).not.toBeNull();
    expect(loaded!.persons).toHaveLength(1);
    expect(loaded!.revision).toBe(tree.revision);
  });

  it('overwrites the live copy on each save', async () => {
    let tree = seed();
    await store.saveTree(tree);
    tree = commit(tree, {});
    await store.saveTree(tree);
    const loaded = await store.loadTree();
    expect(loaded!.revision).toBe(tree.revision);
  });
});

describe('snapshot history', () => {
  it('records a snapshot per save, newest first', async () => {
    let tree = seed();
    await store.saveTree(tree);
    tree = commit(tree, {});
    await store.saveTree(tree);
    const snaps = await store.listSnapshots();
    expect(snaps).toHaveLength(2);
    expect(snaps[0].revision).toBeGreaterThan(snaps[1].revision);
  });

  it('prunes to the last MAX_SNAPSHOTS keeping the newest', async () => {
    let tree = seed();
    for (let i = 0; i < MAX_SNAPSHOTS + 5; i++) {
      await store.saveTree(tree);
      tree = commit(tree, {});
    }
    const snaps = await store.listSnapshots();
    expect(snaps).toHaveLength(MAX_SNAPSHOTS);
    // seed() is revision 1; we saved revisions 1..(MAX_SNAPSHOTS+5). Pruning
    // keeps the newest MAX_SNAPSHOTS, so the oldest retained is revision 6.
    const revisions = snaps.map((s) => s.revision);
    const totalSaved = MAX_SNAPSHOTS + 5;
    expect(Math.min(...revisions)).toBe(totalSaved - MAX_SNAPSHOTS + 1);
    expect(Math.max(...revisions)).toBe(totalSaved);
  });

  it('fetches a specific snapshot by revision', async () => {
    let tree = seed();
    await store.saveTree(tree);
    const target = tree.revision;
    tree = commit(tree, {});
    await store.saveTree(tree);
    const snap = await store.getSnapshot(target);
    expect(snap).not.toBeNull();
    expect(snap!.revision).toBe(target);
  });
});

describe('photo blobs', () => {
  it('stores, reads, and deletes a blob', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    await store.putPhotoBlob({ id: 'ph1', personId: 'p1', mime: 'image/jpeg', blob });
    const got = await store.getPhotoBlob('ph1');
    expect(got).not.toBeNull();
    expect(await got!.blob.arrayBuffer()).toEqual(await blob.arrayBuffer());
    await store.deletePhotoBlob('ph1');
    expect(await store.getPhotoBlob('ph1')).toBeNull();
  });

  it('lists blobs by person', async () => {
    const mk = (id: string, personId: string) =>
      store.putPhotoBlob({
        id,
        personId,
        mime: 'image/jpeg',
        blob: new Blob([id], { type: 'image/jpeg' }),
      });
    await mk('a', 'p1');
    await mk('b', 'p1');
    await mk('c', 'p2');
    expect(await store.getPhotoBlobsForPerson('p1')).toHaveLength(2);
  });
});

describe('import/export hydration', () => {
  it('hydrateForExport attaches blobs to tree.photos', async () => {
    const a = addPerson(createEmptyTree('d'), { given: 'A' });
    const tree = addPhotoRecord(a.tree, {
      id: 'ph1',
      personId: a.person.id,
      mime: 'image/jpeg',
    });
    await store.saveTree(tree);
    await store.putPhotoBlob({
      id: 'ph1',
      personId: a.person.id,
      mime: 'image/jpeg',
      blob: new Blob([new Uint8Array([9, 9, 9])], { type: 'image/jpeg' }),
    });
    const hydrated = await store.hydrateForExport(tree);
    expect(hydrated.photos[0].blob).toBeInstanceOf(Blob);
  });

  it('persistImportedTree writes blobs and dehydrates the tree document', async () => {
    const a = addPerson(createEmptyTree('d'), { given: 'A' });
    let tree = addPhotoRecord(a.tree, {
      id: 'ph1',
      personId: a.person.id,
      mime: 'image/jpeg',
    });
    // Simulate an imported tree carrying a blob on its photo record.
    tree = {
      ...tree,
      photos: [
        {
          id: 'ph1',
          personId: a.person.id,
          mime: 'image/jpeg',
          blob: new Blob([new Uint8Array([7])], { type: 'image/jpeg' }),
        },
      ],
    };
    const persisted = await store.persistImportedTree(tree);
    // Tree document has no blob after persist.
    expect(persisted.photos[0].blob).toBeUndefined();
    // Blob is retrievable from the photo store.
    expect(await store.getPhotoBlob('ph1')).not.toBeNull();
  });
});

describe('bin cleanup', () => {
  const now = new Date('2026-07-02T00:00:00Z');
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000);

  it('purges expired persons and deletes their photo blobs', async () => {
    const a = addPerson(createEmptyTree('d'), { given: 'Old' });
    let tree = addPhotoRecord(a.tree, {
      id: 'ph1',
      personId: a.person.id,
      mime: 'image/jpeg',
    });
    tree = softDeletePerson(tree, a.person.id, () => daysAgo(40));
    await store.saveTree(tree);
    await store.putPhotoBlob({
      id: 'ph1',
      personId: a.person.id,
      mime: 'image/jpeg',
      blob: new Blob(['x'], { type: 'image/jpeg' }),
    });

    const cleaned = await store.cleanupBin(tree, now, 30);
    expect(getPerson(cleaned, a.person.id)).toBeUndefined();
    expect(await store.getPhotoBlob('ph1')).toBeNull();
  });

  it('is a no-op when nothing has expired', async () => {
    const a = addPerson(createEmptyTree('d'), {});
    const tree = softDeletePerson(a.tree, a.person.id, () => daysAgo(1));
    await store.saveTree(tree);
    const cleaned = await store.cleanupBin(tree, now, 30);
    expect(cleaned).toBe(tree);
  });
});

describe('meta store', () => {
  it('stores and retrieves values', async () => {
    await store.setMeta('lastBackup', { at: '2026-07-02', revision: 5 });
    const v = await store.getMeta<{ at: string; revision: number }>('lastBackup');
    expect(v!.revision).toBe(5);
  });

  it('returns null for missing keys', async () => {
    expect(await store.getMeta('missing')).toBeNull();
  });
});
