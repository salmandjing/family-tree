import { describe, it, expect } from 'vitest';
import { createEmptyTree } from '@/core/factories';
import {
  addPerson,
  addPhotoRecord,
  removePhotoRecord,
  getPerson,
  softDeletePerson,
  expiredBinPersonIds,
  purgeExpiredBin,
} from '@/core/operations';

function tree() {
  return createEmptyTree('d');
}

describe('photo records', () => {
  it('adds a photo record and links it to the person', () => {
    const a = addPerson(tree(), { given: 'A' });
    const t = addPhotoRecord(a.tree, {
      id: 'ph1',
      personId: a.person.id,
      mime: 'image/jpeg',
    });
    expect(t.photos).toHaveLength(1);
    expect(getPerson(t, a.person.id)!.photos).toEqual(['ph1']);
  });

  it('rejects a photo for an unknown person', () => {
    expect(() =>
      addPhotoRecord(tree(), { id: 'ph1', personId: 'ghost', mime: 'image/jpeg' }),
    ).toThrow(/not found/);
  });

  it('rejects a duplicate photo id', () => {
    const a = addPerson(tree(), {});
    const t = addPhotoRecord(a.tree, { id: 'ph1', personId: a.person.id, mime: 'image/jpeg' });
    expect(() =>
      addPhotoRecord(t, { id: 'ph1', personId: a.person.id, mime: 'image/jpeg' }),
    ).toThrow(/already exists/);
  });

  it('removes a photo record and unlinks it from the person', () => {
    const a = addPerson(tree(), {});
    let t = addPhotoRecord(a.tree, { id: 'ph1', personId: a.person.id, mime: 'image/jpeg' });
    t = removePhotoRecord(t, 'ph1');
    expect(t.photos).toHaveLength(0);
    expect(getPerson(t, a.person.id)!.photos).toEqual([]);
  });

  it('removePhotoRecord on missing id still commits without throwing', () => {
    const a = addPerson(tree(), {});
    const t = removePhotoRecord(a.tree, 'nope');
    expect(t.photos).toHaveLength(0);
  });
});

describe('bin retention', () => {
  const now = new Date('2026-07-02T00:00:00Z');

  function deletedAt(daysAgo: number): Date {
    return new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  }

  it('flags only persons deleted past the retention window', () => {
    const a = addPerson(tree(), { given: 'Old' });
    const b = addPerson(a.tree, { given: 'Recent' });
    let t = softDeletePerson(b.tree, a.person.id, () => deletedAt(40));
    t = softDeletePerson(t, b.person.id, () => deletedAt(5));
    const expired = expiredBinPersonIds(t, 30, now);
    expect(expired).toEqual([a.person.id]);
  });

  it('purgeExpiredBin removes expired persons and returns same object when none', () => {
    const a = addPerson(tree(), { given: 'Old' });
    const t = softDeletePerson(a.tree, a.person.id, () => deletedAt(40));
    const purged = purgeExpiredBin(t, 30, now);
    expect(getPerson(purged, a.person.id)).toBeUndefined();

    // Nothing expired → same reference.
    const b = addPerson(tree(), {});
    const t2 = softDeletePerson(b.tree, b.person.id, () => deletedAt(1));
    expect(purgeExpiredBin(t2, 30, now)).toBe(t2);
  });
});
