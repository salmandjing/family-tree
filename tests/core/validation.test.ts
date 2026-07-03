import { describe, it, expect } from 'vitest';
import { createEmptyTree } from '@/core/factories';
import { addPerson, addUnion, addChildToUnion } from '@/core/operations';
import { validateTree, assertValidTree } from '@/core/validation';

function validTree() {
  const a = addPerson(createEmptyTree('d'), { given: 'A' });
  const b = addPerson(a.tree, { given: 'B' });
  const u = addUnion(b.tree, [a.person.id, b.person.id], 'married');
  const c = addPerson(u.tree, { given: 'C' });
  return addChildToUnion(c.tree, u.union.id, c.person.id);
}

describe('validateTree', () => {
  it('accepts a well-formed tree', () => {
    const r = validateTree(validTree());
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('rejects non-objects', () => {
    expect(validateTree(null).ok).toBe(false);
    expect(validateTree('nope').ok).toBe(false);
    expect(validateTree([]).ok).toBe(false);
  });

  it('rejects wrong schemaVersion', () => {
    const t = { ...validTree(), schemaVersion: 99 };
    const r = validateTree(t);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /schemaVersion/.test(e.message))).toBe(true);
  });

  it('rejects invalid revision', () => {
    const r = validateTree({ ...validTree(), revision: -1 });
    expect(r.ok).toBe(false);
  });

  it('rejects when persons is not an array', () => {
    const r = validateTree({ ...validTree(), persons: 'x' });
    expect(r.ok).toBe(false);
  });

  it('detects duplicate person ids', () => {
    const t = validTree();
    const dup = { ...t, persons: [...t.persons, t.persons[0]] };
    const r = validateTree(dup);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /Duplicate person id/.test(e.message))).toBe(true);
  });

  it('detects union referencing unknown partner', () => {
    const t = validTree();
    const broken = {
      ...t,
      unions: t.unions.map((u) => ({ ...u, partners: [...u.partners, 'ghost'] })),
    };
    const r = validateTree(broken);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /unknown partner/.test(e.message))).toBe(true);
  });

  it('detects union referencing unknown child', () => {
    const t = validTree();
    const broken = {
      ...t,
      unions: t.unions.map((u) => ({
        ...u,
        children: [...u.children, { personId: 'ghost', relation: 'biological' }],
      })),
    };
    const r = validateTree(broken);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /unknown child/.test(e.message))).toBe(true);
  });

  it('warns (not errors) on orphan photo reference', () => {
    const t = validTree();
    const withPhoto = {
      ...t,
      photos: [{ id: 'ph1', personId: 'ghost', mime: 'image/jpeg', data: '' }],
    };
    const r = validateTree(withPhoto);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => /unknown person/.test(w.message))).toBe(true);
  });

  it('warns on missing deviceId but stays ok', () => {
    const r = validateTree({ ...validTree(), deviceId: '' });
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => /deviceId/.test(w.message))).toBe(true);
  });
});

describe('assertValidTree', () => {
  it('passes through valid trees', () => {
    expect(() => assertValidTree(validTree())).not.toThrow();
  });

  it('throws on invalid trees with a summary', () => {
    expect(() => assertValidTree({ foo: 'bar' })).toThrow(/Invalid family tree/);
  });
});
