import { describe, it, expect } from 'vitest';
import { createEmptyTree } from '@/core/factories';
import {
  addPerson,
  addUnion,
  addChildToUnion,
  addPartnerToUnion,
  patchPerson,
  updatePerson,
  softDeletePerson,
  restorePerson,
  purgePerson,
  setUnionStatus,
  removeChildFromUnion,
  attachPhotoToPerson,
  detachPhotoFromPerson,
  setPrimaryPhoto,
  insertPerson,
  insertUnion,
  activePersons,
  deletedPersons,
  getPerson,
  commit,
} from '@/core/operations';
import type { FamilyTree } from '@/core/types';

// Deterministic clock for savedAt assertions.
const fixed = new Date('2026-07-02T14:00:00.000Z');
const clock = () => fixed;

function emptyTree(): FamilyTree {
  return createEmptyTree('device-A');
}

describe('commit', () => {
  it('bumps revision and stamps savedAt without mutating input', () => {
    const t0 = emptyTree();
    const t1 = commit(t0, { persons: [] }, clock);
    expect(t1.revision).toBe(1);
    expect(t1.savedAt).toBe(fixed.toISOString());
    // original untouched
    expect(t0.revision).toBe(0);
    expect(t1).not.toBe(t0);
  });

  it('increments monotonically across successive commits', () => {
    let t = emptyTree();
    for (let i = 1; i <= 5; i++) {
      t = commit(t, {}, clock);
      expect(t.revision).toBe(i);
    }
  });
});

describe('addPerson', () => {
  it('adds a person and returns it, immutably', () => {
    const t0 = emptyTree();
    const { tree, person } = addPerson(t0, { given: 'Amina' }, clock);
    expect(tree.persons).toHaveLength(1);
    expect(person.name.given).toBe('Amina');
    expect(tree.revision).toBe(1);
    // input unchanged
    expect(t0.persons).toHaveLength(0);
  });

  it('defaults living=true when no death date', () => {
    const { person } = addPerson(emptyTree(), { given: 'X' });
    expect(person.living).toBe(true);
    expect(person.death.date).toBeNull();
  });

  it('marks living=false when a death date is provided', () => {
    const { person } = addPerson(emptyTree(), { death: { date: '2000' } });
    expect(person.living).toBe(false);
  });
});

describe('insertPerson / insertUnion', () => {
  it('inserts a prebuilt person', () => {
    const { tree, person } = addPerson(emptyTree(), { given: 'A' });
    const clone = { ...person, id: 'p-new' };
    const t2 = insertPerson(tree, clone);
    expect(getPerson(t2, 'p-new')).toBeDefined();
  });

  it('rejects duplicate person id', () => {
    const { tree, person } = addPerson(emptyTree(), {});
    expect(() => insertPerson(tree, person)).toThrow(/already exists/);
  });

  it('rejects duplicate union id', () => {
    const { tree, person } = addPerson(emptyTree(), {});
    const { tree: t2, union } = addUnion(tree, [person.id]);
    expect(() => insertUnion(t2, union)).toThrow(/already exists/);
  });
});

describe('updatePerson / patchPerson', () => {
  it('updates via updater', () => {
    const { tree, person } = addPerson(emptyTree(), { given: 'A' });
    const t2 = updatePerson(tree, person.id, (p) => ({ ...p, notes: 'hello' }));
    expect(getPerson(t2, person.id)!.notes).toBe('hello');
  });

  it('throws when updater changes id', () => {
    const { tree, person } = addPerson(emptyTree(), {});
    expect(() =>
      updatePerson(tree, person.id, (p) => ({ ...p, id: 'other' })),
    ).toThrow(/must not change person id/);
  });

  it('throws for missing person', () => {
    expect(() => patchPerson(emptyTree(), 'nope', { notes: 'x' })).toThrow(
      /not found/,
    );
  });

  it('patchPerson merges fields', () => {
    const { tree, person } = addPerson(emptyTree(), { given: 'A' });
    const t2 = patchPerson(tree, person.id, { sex: 'F' });
    expect(getPerson(t2, person.id)!.sex).toBe('F');
    expect(getPerson(t2, person.id)!.name.given).toBe('A');
  });
});

describe('soft delete / restore / purge', () => {
  it('soft delete moves person to bin and keeps links intact', () => {
    const { tree, person } = addPerson(emptyTree(), { given: 'A' });
    const t2 = softDeletePerson(tree, person.id, clock);
    expect(getPerson(t2, person.id)!.deletedAt).toBe(fixed.toISOString());
    expect(activePersons(t2)).toHaveLength(0);
    expect(deletedPersons(t2)).toHaveLength(1);
  });

  it('soft delete is idempotent (no-op second time)', () => {
    const { tree, person } = addPerson(emptyTree(), {});
    const t2 = softDeletePerson(tree, person.id, clock);
    const t3 = softDeletePerson(t2, person.id, clock);
    expect(t3).toBe(t2);
  });

  it('restore returns person to active set', () => {
    const { tree, person } = addPerson(emptyTree(), {});
    const t2 = softDeletePerson(tree, person.id, clock);
    const t3 = restorePerson(t2, person.id);
    expect(getPerson(t3, person.id)!.deletedAt).toBeNull();
    expect(activePersons(t3)).toHaveLength(1);
  });

  it('restore is idempotent for active person', () => {
    const { tree, person } = addPerson(emptyTree(), {});
    const t2 = restorePerson(tree, person.id);
    expect(t2).toBe(tree);
  });

  it('purge removes person and scrubs union references', () => {
    let tree = emptyTree();
    const a = addPerson(tree, { given: 'A' });
    tree = a.tree;
    const b = addPerson(tree, { given: 'B' });
    tree = b.tree;
    const child = addPerson(tree, { given: 'C' });
    tree = child.tree;
    const u = addUnion(tree, [a.person.id, b.person.id], 'married');
    tree = u.tree;
    tree = addChildToUnion(tree, u.union.id, child.person.id);

    const purged = purgePerson(tree, b.person.id);
    expect(getPerson(purged, b.person.id)).toBeUndefined();
    const union = purged.unions[0];
    expect(union.partners).toEqual([a.person.id]);
    // child still present since only B was purged
    expect(union.children.map((c) => c.personId)).toContain(child.person.id);
  });

  it('purge drops a union left with no partners and no children', () => {
    let tree = emptyTree();
    const a = addPerson(tree, {});
    tree = a.tree;
    const u = addUnion(tree, [a.person.id]);
    tree = u.tree;
    const purged = purgePerson(tree, a.person.id);
    expect(purged.unions).toHaveLength(0);
  });
});

describe('union operations', () => {
  it('addUnion validates partners exist', () => {
    expect(() => addUnion(emptyTree(), ['ghost'])).toThrow(/not found/);
  });

  it('setUnionStatus updates status', () => {
    const a = addPerson(emptyTree(), {});
    const u = addUnion(a.tree, [a.person.id]);
    const t = setUnionStatus(u.tree, u.union.id, 'divorced');
    expect(t.unions[0].status).toBe('divorced');
  });

  it('addPartnerToUnion is idempotent', () => {
    const a = addPerson(emptyTree(), {});
    const b = addPerson(a.tree, {});
    const u = addUnion(b.tree, [a.person.id]);
    const t = addPartnerToUnion(u.tree, u.union.id, b.person.id);
    const t2 = addPartnerToUnion(t, u.union.id, b.person.id);
    expect(t2.unions[0].partners).toEqual([a.person.id, b.person.id]);
  });

  it('addChildToUnion refuses unknown person', () => {
    const a = addPerson(emptyTree(), {});
    const u = addUnion(a.tree, [a.person.id]);
    expect(() => addChildToUnion(u.tree, u.union.id, 'ghost')).toThrow(/not found/);
  });

  it('addChildToUnion is idempotent and honors relation', () => {
    const a = addPerson(emptyTree(), {});
    const c = addPerson(a.tree, {});
    const u = addUnion(c.tree, [a.person.id]);
    let t = addChildToUnion(u.tree, u.union.id, c.person.id, 'adopted');
    t = addChildToUnion(t, u.union.id, c.person.id, 'biological');
    expect(t.unions[0].children).toHaveLength(1);
    expect(t.unions[0].children[0].relation).toBe('adopted');
  });

  it('removeChildFromUnion drops the child link only', () => {
    const a = addPerson(emptyTree(), {});
    const c = addPerson(a.tree, {});
    const u = addUnion(c.tree, [a.person.id]);
    let t = addChildToUnion(u.tree, u.union.id, c.person.id);
    t = removeChildFromUnion(t, u.union.id, c.person.id);
    expect(t.unions[0].children).toHaveLength(0);
    expect(getPerson(t, c.person.id)).toBeDefined();
  });
});

describe('photo references', () => {
  it('attach adds photo id; first is primary', () => {
    const a = addPerson(emptyTree(), {});
    let t = attachPhotoToPerson(a.tree, a.person.id, 'ph1');
    t = attachPhotoToPerson(t, a.person.id, 'ph2');
    expect(getPerson(t, a.person.id)!.photos).toEqual(['ph1', 'ph2']);
  });

  it('attach is idempotent', () => {
    const a = addPerson(emptyTree(), {});
    let t = attachPhotoToPerson(a.tree, a.person.id, 'ph1');
    t = attachPhotoToPerson(t, a.person.id, 'ph1');
    expect(getPerson(t, a.person.id)!.photos).toEqual(['ph1']);
  });

  it('detach removes the photo id', () => {
    const a = addPerson(emptyTree(), {});
    let t = attachPhotoToPerson(a.tree, a.person.id, 'ph1');
    t = detachPhotoFromPerson(t, a.person.id, 'ph1');
    expect(getPerson(t, a.person.id)!.photos).toEqual([]);
  });

  it('setPrimaryPhoto moves photo to front', () => {
    const a = addPerson(emptyTree(), {});
    let t = attachPhotoToPerson(a.tree, a.person.id, 'ph1');
    t = attachPhotoToPerson(t, a.person.id, 'ph2');
    t = setPrimaryPhoto(t, a.person.id, 'ph2');
    expect(getPerson(t, a.person.id)!.photos).toEqual(['ph2', 'ph1']);
  });

  it('setPrimaryPhoto is a no-op for unattached photo', () => {
    const a = addPerson(emptyTree(), {});
    const t = setPrimaryPhoto(a.tree, a.person.id, 'ghost');
    expect(getPerson(t, a.person.id)!.photos).toEqual([]);
  });
});
