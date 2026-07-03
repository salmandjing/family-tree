import { describe, it, expect } from 'vitest';
import { createEmptyTree } from '@/core/factories';
import { addPerson, addUnion } from '@/core/operations';
import {
  addSpouse,
  addChild,
  addParent,
  spouseIds,
  childIds,
  parentIds,
  siblingIds,
  unionsAsPartner,
  unionsAsChild,
} from '@/core/relationships';

function tree() {
  return createEmptyTree('device-A');
}

describe('addSpouse', () => {
  it('creates spouse and a linking union', () => {
    const a = addPerson(tree(), { given: 'A' });
    const r = addSpouse(a.tree, a.person.id, { given: 'B' }, 'married');
    expect(r.union.partners).toEqual([a.person.id, r.person.id]);
    expect(r.union.status).toBe('married');
    expect(spouseIds(r.tree, a.person.id)).toEqual([r.person.id]);
  });

  it('supports polygamy: multiple spouses each in their own union', () => {
    const a = addPerson(tree(), { given: 'A' });
    const s1 = addSpouse(a.tree, a.person.id, { given: 'W1' });
    const s2 = addSpouse(s1.tree, a.person.id, { given: 'W2' });
    expect(unionsAsPartner(s2.tree, a.person.id)).toHaveLength(2);
    expect(spouseIds(s2.tree, a.person.id).sort()).toEqual(
      [s1.person.id, s2.person.id].sort(),
    );
  });

  it('throws for unknown person', () => {
    expect(() => addSpouse(tree(), 'ghost')).toThrow(/not found/);
  });
});

describe('addChild', () => {
  it('adds a child to an only union automatically', () => {
    const a = addPerson(tree(), { given: 'A' });
    const s = addSpouse(a.tree, a.person.id, { given: 'B' });
    const c = addChild(s.tree, a.person.id, { given: 'C' });
    expect(childIds(c.tree, a.person.id)).toEqual([c.person.id]);
    expect(parentIds(c.tree, c.person.id).sort()).toEqual(
      [a.person.id, s.person.id].sort(),
    );
  });

  it('creates a solo union when the person has none', () => {
    const a = addPerson(tree(), { given: 'A' });
    const c = addChild(a.tree, a.person.id, { given: 'C' });
    expect(unionsAsPartner(c.tree, a.person.id)).toHaveLength(1);
    expect(childIds(c.tree, a.person.id)).toEqual([c.person.id]);
  });

  it('requires a unionId when the person has multiple unions', () => {
    const a = addPerson(tree(), { given: 'A' });
    const s1 = addSpouse(a.tree, a.person.id, { given: 'W1' });
    const s2 = addSpouse(s1.tree, a.person.id, { given: 'W2' });
    expect(() => addChild(s2.tree, a.person.id, { given: 'C' })).toThrow(
      /multiple unions/,
    );
    // but works when a union is specified
    const firstUnion = unionsAsPartner(s2.tree, a.person.id)[0];
    const c = addChild(s2.tree, a.person.id, { given: 'C' }, {
      unionId: firstUnion.id,
    });
    expect(childIds(c.tree, a.person.id)).toContain(c.person.id);
  });

  it('rejects a unionId the person is not part of', () => {
    const a = addPerson(tree(), { given: 'A' });
    const other = addPerson(a.tree, { given: 'O' });
    const u = addUnion(other.tree, [other.person.id]);
    expect(() =>
      addChild(u.tree, a.person.id, {}, { unionId: u.union.id }),
    ).toThrow(/not a partner/);
  });

  it('honors relation type', () => {
    const a = addPerson(tree(), { given: 'A' });
    const c = addChild(a.tree, a.person.id, { given: 'C' }, {
      relation: 'adopted',
    });
    expect(c.union.children[0].relation).toBe('adopted');
  });
});

describe('addParent', () => {
  it('creates a parent union with the person as child', () => {
    const a = addPerson(tree(), { given: 'A' });
    const p = addParent(a.tree, a.person.id, { given: 'Dad' });
    expect(parentIds(p.tree, a.person.id)).toEqual([p.person.id]);
    expect(unionsAsChild(p.tree, a.person.id)).toHaveLength(1);
  });

  it('joins the existing parent union for the second parent', () => {
    const a = addPerson(tree(), { given: 'A' });
    const dad = addParent(a.tree, a.person.id, { given: 'Dad' });
    const mom = addParent(dad.tree, a.person.id, { given: 'Mom' });
    // still a single parent union, now with two partners
    expect(unionsAsChild(mom.tree, a.person.id)).toHaveLength(1);
    expect(parentIds(mom.tree, a.person.id).sort()).toEqual(
      [dad.person.id, mom.person.id].sort(),
    );
  });

  it('creates a new parent union once two parents already exist', () => {
    const a = addPerson(tree(), { given: 'A' });
    const dad = addParent(a.tree, a.person.id, { given: 'Dad' });
    const mom = addParent(dad.tree, a.person.id, { given: 'Mom' });
    const third = addParent(mom.tree, a.person.id, { given: 'Step' });
    expect(unionsAsChild(third.tree, a.person.id)).toHaveLength(2);
  });
});

describe('siblings and half-siblings', () => {
  it('full siblings share a parent union', () => {
    const dad = addPerson(tree(), { given: 'Dad' });
    const c1 = addChild(dad.tree, dad.person.id, { given: 'C1' });
    const union = c1.union;
    const c2 = addChild(c1.tree, dad.person.id, { given: 'C2' }, {
      unionId: union.id,
    });
    expect(siblingIds(c2.tree, c1.person.id)).toEqual([c2.person.id]);
  });

  it('half-siblings from different unions are not full siblings but appear via a shared parent', () => {
    // Dad has children with two different partners.
    const dad = addPerson(tree(), { given: 'Dad' });
    const w1 = addSpouse(dad.tree, dad.person.id, { given: 'W1' });
    const w2 = addSpouse(w1.tree, dad.person.id, { given: 'W2' });
    const u1 = unionsAsPartner(w2.tree, dad.person.id)[0];
    const u2 = unionsAsPartner(w2.tree, dad.person.id)[1];
    const c1 = addChild(w2.tree, dad.person.id, { given: 'C1' }, { unionId: u1.id });
    const c2 = addChild(c1.tree, dad.person.id, { given: 'C2' }, { unionId: u2.id });
    // They are NOT full siblings (different parent unions)...
    expect(siblingIds(c2.tree, c1.person.id)).toEqual([]);
    // ...but both are children of dad.
    expect(childIds(c2.tree, dad.person.id).sort()).toEqual(
      [c1.person.id, c2.person.id].sort(),
    );
  });
});
