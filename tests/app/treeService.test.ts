import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalStore } from '@/store/localStore';
import { TreeService } from '@/app/treeService';
import { addPerson } from '@/core/operations';
import { addSpouse } from '@/core/relationships';
import type { Compressor } from '@/app/photoService';

// A no-op compressor: returns the input unchanged so tests avoid a real canvas.
const passthroughCompressor: Compressor = async (file) => file;

const fixedClock = () => new Date('2026-07-02T14:00:00Z');

let store: LocalStore;
let service: TreeService;
let dbn = 0;

beforeEach(async () => {
  store = await LocalStore.open(`svc-db-${dbn++}`);
  service = new TreeService({
    store,
    deviceId: 'device-A',
    compressor: passthroughCompressor,
    clock: fixedClock,
    now: () => new Date('2026-07-02T14:00:00Z'),
  });
  await service.init();
});

afterEach(() => {
  service.dispose();
  store.close();
});

describe('init', () => {
  it('starts from an empty tree and persists it', async () => {
    expect(service.getTree().persons).toHaveLength(0);
    expect(await store.loadTree()).not.toBeNull();
  });

  it('loads a previously saved tree', async () => {
    await service.apply((t, clock) => addPerson(t, { given: 'A' }, clock).tree);
    const service2 = new TreeService({ store, deviceId: 'device-A', clock: fixedClock });
    await service2.init();
    expect(service2.getTree().persons).toHaveLength(1);
    service2.dispose();
  });
});

describe('apply + notify', () => {
  it('applies a mutation, persists it, and notifies subscribers', async () => {
    let calls = 0;
    const unsub = service.subscribe(() => calls++);
    await service.apply((t, clock) => addPerson(t, { given: 'Amina' }, clock).tree);
    expect(service.getTree().persons).toHaveLength(1);
    expect(calls).toBe(1);
    expect((await store.loadTree())!.persons).toHaveLength(1);
    unsub();
  });

  it('skips save for a no-op mutation', async () => {
    let calls = 0;
    service.subscribe(() => calls++);
    await service.apply((t) => t); // returns same reference
    expect(calls).toBe(0);
  });
});

describe('undo/redo', () => {
  it('undoes and redoes an edit while keeping revision monotonic', async () => {
    await service.apply((t, clock) => addPerson(t, { given: 'A' }, clock).tree);
    const afterAdd = service.getTree();
    expect(service.canUndo()).toBe(true);

    await service.undo();
    expect(service.getTree().persons).toHaveLength(0);
    // revision moved forward, not backward
    expect(service.getTree().revision).toBeGreaterThan(afterAdd.revision);
    expect(service.canRedo()).toBe(true);

    await service.redo();
    expect(service.getTree().persons).toHaveLength(1);
    expect(service.getTree().revision).toBeGreaterThan(afterAdd.revision);
  });

  it('undo is a no-op with empty history', async () => {
    const before = service.getTree();
    await service.undo();
    expect(service.getTree()).toBe(before);
  });

  it('a new edit clears the redo stack', async () => {
    await service.apply((t, clock) => addPerson(t, { given: 'A' }, clock).tree);
    await service.undo();
    expect(service.canRedo()).toBe(true);
    await service.apply((t, clock) => addPerson(t, { given: 'B' }, clock).tree);
    expect(service.canRedo()).toBe(false);
  });
});

describe('soft delete / restore / purge', () => {
  it('soft-deletes then restores a person', async () => {
    const added = await service.apply((t, clock) =>
      addPerson(t, { given: 'A' }, clock).tree,
    );
    const id = added.persons[0].id;
    await service.deletePerson(id);
    expect(service.getTree().persons[0].deletedAt).not.toBeNull();
    await service.restoreDeletedPerson(id);
    expect(service.getTree().persons[0].deletedAt).toBeNull();
  });

  it('purges a person and removes their photo blob', async () => {
    const added = await service.apply((t, clock) =>
      addPerson(t, { given: 'A' }, clock).tree,
    );
    const id = added.persons[0].id;
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    const photoId = await service.addPhoto(id, blob);
    expect(await store.getPhotoBlob(photoId)).not.toBeNull();

    await service.purgePersonNow(id);
    expect(service.getTree().persons).toHaveLength(0);
    expect(await store.getPhotoBlob(photoId)).toBeNull();
  });
});

describe('photos', () => {
  it('adds a photo, stores the blob, and links the record', async () => {
    const added = await service.apply((t, clock) =>
      addPerson(t, { given: 'A' }, clock).tree,
    );
    const id = added.persons[0].id;
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    const photoId = await service.addPhoto(id, blob);

    expect(service.getTree().photos).toHaveLength(1);
    expect(service.getTree().persons[0].photos).toEqual([photoId]);
    const url = await service.getAvatarUrl(photoId);
    expect(url).toMatch(/^blob:/);
    // cached on second call
    expect(await service.getAvatarUrl(photoId)).toBe(url);
  });

  it('removes a photo and its blob', async () => {
    const added = await service.apply((t, clock) =>
      addPerson(t, { given: 'A' }, clock).tree,
    );
    const id = added.persons[0].id;
    const photoId = await service.addPhoto(
      id,
      new Blob([new Uint8Array([1])], { type: 'image/jpeg' }),
    );
    await service.removePhoto(photoId);
    expect(service.getTree().photos).toHaveLength(0);
    expect(await store.getPhotoBlob(photoId)).toBeNull();
  });

  it('rejects a non-image file', async () => {
    const added = await service.apply((t, clock) =>
      addPerson(t, { given: 'A' }, clock).tree,
    );
    const id = added.persons[0].id;
    const bad = new Blob(['hello'], { type: 'text/plain' });
    await expect(service.addPhoto(id, bad)).rejects.toThrow(/not an image/);
  });
});

describe('export / import round-trip', () => {
  it('exports the tree to JSON and re-imports it into a fresh service', async () => {
    await service.apply((t, clock) => {
      const a = addPerson(t, { given: 'Dad', sex: 'M' }, clock);
      return addSpouse(a.tree, a.person.id, { given: 'Mom', sex: 'F' }, 'married', clock).tree;
    });
    const blob = new Blob([new Uint8Array([5, 6, 7])], { type: 'image/jpeg' });
    const dadId = service.getTree().persons[0].id;
    await service.addPhoto(dadId, blob);

    const json = await service.exportJson();
    expect(json).toContain('Mom');

    const store2 = await LocalStore.open(`svc-db-import-${dbn++}`);
    const service2 = new TreeService({ store: store2, deviceId: 'device-B' });
    await service2.init();
    const imported = await service2.importJson(json);

    expect(imported.persons).toHaveLength(2);
    expect(imported.photos).toHaveLength(1);
    // blob landed in the new store
    expect(await store2.getPhotoBlob(imported.photos[0].id)).not.toBeNull();
    service2.dispose();
    store2.close();
  });

  it('rejects malformed import JSON', async () => {
    await expect(service.importJson('{bad')).rejects.toThrow(/not valid JSON/);
  });
});
