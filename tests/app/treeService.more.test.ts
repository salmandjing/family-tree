import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalStore } from '@/store/localStore';
import { TreeService } from '@/app/treeService';
import { addPerson, softDeletePerson } from '@/core/operations';
import type { Compressor } from '@/app/photoService';

const passthrough: Compressor = async (f) => f;
const clock = () => new Date('2026-07-02T14:00:00Z');

let store: LocalStore;
let service: TreeService;
let dbn = 0;

beforeEach(async () => {
  store = await LocalStore.open(`svc-more-${dbn++}`);
  service = new TreeService({ store, deviceId: 'device-A', compressor: passthrough, clock });
  await service.init();
});
afterEach(() => service.dispose());

describe('restoreSnapshot', () => {
  it('restores an earlier version as a new higher revision', async () => {
    await service.apply((t, c) => addPerson(t, { given: 'A' }, c).tree);
    const snapAfterA = service.getTree().revision;
    await service.apply((t, c) => addPerson(t, { given: 'B' }, c).tree);
    expect(service.getTree().persons).toHaveLength(2);

    await service.restoreSnapshot(snapAfterA);
    expect(service.getTree().persons.map((p) => p.name.given)).toEqual(['A']);
    expect(service.getTree().revision).toBeGreaterThan(snapAfterA);
  });

  it('throws for a missing snapshot revision', async () => {
    await expect(service.restoreSnapshot(9999)).rejects.toThrow(/no longer exists/);
  });

  it('a restore can itself be undone', async () => {
    await service.apply((t, c) => addPerson(t, { given: 'A' }, c).tree);
    const rev = service.getTree().revision;
    await service.apply((t, c) => addPerson(t, { given: 'B' }, c).tree);
    await service.restoreSnapshot(rev);
    expect(service.getTree().persons).toHaveLength(1);
    await service.undo();
    expect(service.getTree().persons).toHaveLength(2);
  });
});

describe('getAvatarUrl', () => {
  it('returns null when the photo blob is missing', async () => {
    expect(await service.getAvatarUrl('nope')).toBeNull();
  });

  it('caches and exposes urls via avatarUrlMap', async () => {
    const added = await service.apply((t, c) => addPerson(t, { given: 'A' }, c).tree);
    const id = added.persons[0].id;
    const photoId = await service.addPhoto(
      id,
      new Blob([new Uint8Array([1, 2])], { type: 'image/jpeg' }),
    );
    const url = await service.getAvatarUrl(photoId);
    expect(service.avatarUrlMap().get(photoId)).toBe(url);
  });
});

describe('bin cleanup on init', () => {
  it('purges expired people when the service starts', async () => {
    // Seed an expired soft-deleted person directly into the store.
    const added = await service.apply((t, c) => addPerson(t, { given: 'Old' }, c).tree);
    const id = added.persons[0].id;
    const longAgo = () => new Date('2026-05-01T00:00:00Z'); // >30 days before clock
    const withDeleted = softDeletePerson(service.getTree(), id, longAgo);
    await store.saveTree(withDeleted);

    // Re-open a service with "now" well after the deletion.
    const svc2 = new TreeService({
      store,
      deviceId: 'device-A',
      compressor: passthrough,
      clock,
      now: () => new Date('2026-07-02T00:00:00Z'),
    });
    await svc2.init();
    expect(svc2.getTree().persons.find((p) => p.id === id)).toBeUndefined();
    svc2.dispose();
  });
});

describe('export pretty vs compact', () => {
  it('pretty output contains newlines; compact does not', async () => {
    await service.apply((t, c) => addPerson(t, { given: 'A' }, c).tree);
    expect(await service.exportJson(true)).toContain('\n');
    expect(await service.exportJson(false)).not.toContain('\n');
  });
});

describe('history bounded, undo after many edits', () => {
  it('undo walks back through several edits', async () => {
    for (const name of ['A', 'B', 'C', 'D']) {
      await service.apply((t, c) => addPerson(t, { given: name }, c).tree);
    }
    expect(service.getTree().persons).toHaveLength(4);
    await service.undo();
    await service.undo();
    expect(service.getTree().persons).toHaveLength(2);
  });
});
