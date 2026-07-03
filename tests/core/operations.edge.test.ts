import { describe, it, expect } from 'vitest';
import { createEmptyTree } from '@/core/factories';
import {
  addPerson,
  addUnion,
  addChildToUnion,
  purgePerson,
  softDeletePerson,
  expiredBinPersonIds,
  purgeExpiredBin,
  addPhotoRecord,
  removePhotoRecord,
  setPrimaryPhoto,
  getPerson,
} from '@/core/operations';
import { addChild, addParent, addSpouse, siblingIds } from '@/core/relationships';

function tree() {
  return createEmptyTree('d');
}

describe('purge cascades', () => {
  it('purging a child-only person removes just the child link', () => {
    const dad = addPerson(tree(), { given: 'Dad' });
    const c = addChild(dad.tree, dad.person.id, { given: 'C' });
    const purged = purgePerson(c.tree, c.person.id);
    expect(getPerson(purged, c.person.id)).toBeUndefined();
    // Union with the parent survives (still has a partner).
    expect(purged.unions[0].partners).toEqual([dad.person.id]);
    expect(purged.unions[0].children).toHaveLength(0);
  });

  it('purging a person removes them from ALL unions (polygamy)', () => {
    const dad = addPerson(tree(), { given: 'Dad' });
    const w1 = addSpouse(dad.tree, dad.person.id, { given: 'W1' });
    const w2 = addSpouse(w1.tree, dad.person.id, { given: 'W2' });
    const purged = purgePerson(w2.tree, dad.person.id);
    // Both unions lose dad; each still has the wife, so both survive.
    expect(purged.unions).toHaveLength(2);
    for (const u of purged.unions) expect(u.partners).not.toContain(dad.person.id);
  });
});

describe('bin retention boundary', () => {
  const now = new Date('2026-07-02T00:00:00Z');
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000);

  it('a person deleted exactly at the cutoff is expired (<=)', () => {
    const a = addPerson(tree(), {});
    const t = softDeletePerson(a.tree, a.person.id, () => daysAgo(30));
    expect(expiredBinPersonIds(t, 30, now)).toEqual([a.person.id]);
  });

  it('a person deleted one second inside the window is NOT expired', () => {
    const a = addPerson(tree(), {});
    const justInside = new Date(now.getTime() - (30 * 86400000 - 1000));
    const t = softDeletePerson(a.tree, a.person.id, () => justInside);
    expect(expiredBinPersonIds(t, 30, now)).toEqual([]);
  });

  it('purgeExpiredBin purges multiple expired people in one pass', () => {
    let t = tree();
    const a = addPerson(t, { given: 'A' });
    t = a.tree;
    const b = addPerson(t, { given: 'B' });
    t = b.tree;
    t = softDeletePerson(t, a.person.id, () => daysAgo(40));
    t = softDeletePerson(t, b.person.id, () => daysAgo(35));
    const purged = purgeExpiredBin(t, 30, now);
    expect(purged.persons).toHaveLength(0);
  });
});

describe('addChild union disambiguation', () => {
  it('adds to the specified union among several', () => {
    const dad = addPerson(tree(), { given: 'Dad' });
    const w1 = addSpouse(dad.tree, dad.person.id, { given: 'W1' });
    const w2 = addSpouse(w1.tree, dad.person.id, { given: 'W2' });
    // Union with W2 is the second one.
    const targetUnion = w2.union.id;
    const child = addChild(w2.tree, dad.person.id, { given: 'C' }, { unionId: targetUnion });
    const union = child.tree.unions.find((u) => u.id === targetUnion)!;
    expect(union.children.map((c) => c.personId)).toContain(child.person.id);
    // The child's parents are Dad + W2 (not W1).
    expect(union.partners.sort()).toEqual([dad.person.id, w2.person.id].sort());
  });
});

describe('siblings across a re-created parent union', () => {
  it('children added to the same union are siblings', () => {
    const dad = addPerson(tree(), { given: 'Dad' });
    const c1 = addChild(dad.tree, dad.person.id, { given: 'C1' });
    const c2 = addChild(c1.tree, dad.person.id, { given: 'C2' }, { unionId: c1.union.id });
    expect(siblingIds(c2.tree, c1.person.id)).toEqual([c2.person.id]);
    expect(siblingIds(c2.tree, c2.person.id)).toEqual([c1.person.id]);
  });
});

describe('photo record + primary ordering', () => {
  it('keeps person.photos and tree.photos consistent through add/remove', () => {
    const a = addPerson(tree(), { given: 'A' });
    let t = addPhotoRecord(a.tree, { id: 'p1', personId: a.person.id, mime: 'image/jpeg' });
    t = addPhotoRecord(t, { id: 'p2', personId: a.person.id, mime: 'image/jpeg' });
    t = setPrimaryPhoto(t, a.person.id, 'p2');
    expect(getPerson(t, a.person.id)!.photos).toEqual(['p2', 'p1']);
    expect(t.photos.map((p) => p.id).sort()).toEqual(['p1', 'p2']);

    t = removePhotoRecord(t, 'p2');
    expect(getPerson(t, a.person.id)!.photos).toEqual(['p1']);
    expect(t.photos.map((p) => p.id)).toEqual(['p1']);
  });
});

describe('addParent then addChild interplay', () => {
  it('a grandparent chain links three generations', () => {
    const me = addPerson(tree(), { given: 'Me' });
    const parent = addParent(me.tree, me.person.id, { given: 'Parent' });
    const grand = addParent(parent.tree, parent.person.id, { given: 'Grand' });
    // Me's parent is Parent; Parent's parent is Grand.
    const meParents = grand.tree.unions
      .filter((u) => u.children.some((c) => c.personId === me.person.id))
      .flatMap((u) => u.partners);
    expect(meParents).toContain(parent.person.id);
    const parentParents = grand.tree.unions
      .filter((u) => u.children.some((c) => c.personId === parent.person.id))
      .flatMap((u) => u.partners);
    expect(parentParents).toContain(grand.person.id);
  });
});

describe('addUnion validation and status', () => {
  it('rejects children referencing a non-partner union member? (children can be anyone)', () => {
    // Children need only exist; they are independent of partner membership.
    const a = addPerson(tree(), { given: 'A' });
    const c = addPerson(a.tree, { given: 'C' });
    const u = addUnion(c.tree, [a.person.id], 'partner');
    const t = addChildToUnion(u.tree, u.union.id, c.person.id);
    expect(t.unions[0].children[0].personId).toBe(c.person.id);
    expect(t.unions[0].status).toBe('partner');
  });
});
