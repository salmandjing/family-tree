import { describe, it, expect } from 'vitest';
import { createEmptyTree } from '@/core/factories';
import { addPerson, softDeletePerson } from '@/core/operations';
import { addChild, addSpouse } from '@/core/relationships';
import { toRenderData, hasRenderableData, pickRoot } from '@/render/adapter';

function familyOfThree() {
  const dad = addPerson(createEmptyTree('d'), { given: 'Dad', sex: 'M' });
  const withMom = addSpouse(dad.tree, dad.person.id, { given: 'Mom', sex: 'F' });
  const withKid = addChild(withMom.tree, dad.person.id, { given: 'Kid', sex: 'unknown' });
  return {
    tree: withKid.tree,
    dad: dad.person.id,
    mom: withMom.person.id,
    kid: withKid.person.id,
  };
}

describe('toRenderData', () => {
  it('maps persons to family-chart data with rels', () => {
    const { tree, dad, mom, kid } = familyOfThree();
    const data = toRenderData(tree);
    expect(data).toHaveLength(3);

    const kidDatum = data.find((d) => d.id === kid)!;
    expect(kidDatum.rels.parents.sort()).toEqual([dad, mom].sort());
    expect(kidDatum.data['first name']).toBe('Kid');

    const dadDatum = data.find((d) => d.id === dad)!;
    expect(dadDatum.rels.spouses).toEqual([mom]);
    expect(dadDatum.rels.children).toEqual([kid]);
  });

  it('maps sex to gender and defaults unknown to M while preserving _sex', () => {
    const { tree, kid } = familyOfThree();
    const kidDatum = toRenderData(tree).find((d) => d.id === kid)!;
    expect(kidDatum.data.gender).toBe('M'); // unknown → default
    expect(kidDatum.data._sex).toBe('unknown'); // real value preserved
  });

  it('maps female sex to F', () => {
    const { tree, mom } = familyOfThree();
    const momDatum = toRenderData(tree).find((d) => d.id === mom)!;
    expect(momDatum.data.gender).toBe('F');
    expect(momDatum.data._sex).toBe('F');
  });

  it('honors the approx flag in the birthday label', () => {
    const a = addPerson(createEmptyTree('d'), {
      given: 'Old',
      birth: { date: '1950', approx: true },
    });
    const datum = toRenderData(a.tree)[0];
    expect(datum.data.birthday).toBe('~1950');
  });

  it('shows an exact birthday without a tilde', () => {
    const a = addPerson(createEmptyTree('d'), {
      given: 'X',
      birth: { date: '1980', approx: false },
    });
    expect(toRenderData(a.tree)[0].data.birthday).toBe('1980');
  });

  it('excludes soft-deleted persons and drops links to them', () => {
    const { tree, dad, mom, kid } = familyOfThree();
    const pruned = softDeletePerson(tree, mom);
    const data = toRenderData(pruned);
    expect(data.map((d) => d.id)).not.toContain(mom);
    const kidDatum = data.find((d) => d.id === kid)!;
    expect(kidDatum.rels.parents).toEqual([dad]); // mom link dropped
  });

  it('resolves avatar urls from the provided map', () => {
    const a = addPerson(createEmptyTree('d'), { given: 'A' });
    let tree = a.tree;
    tree = { ...tree, persons: tree.persons.map((p) => ({ ...p, photos: ['ph1'] })) };
    const urls = new Map([['ph1', 'blob:fake-url']]);
    expect(toRenderData(tree, urls)[0].data.avatar).toBe('blob:fake-url');
    expect(toRenderData(tree, urls)[0].data._hasPhoto).toBe(true);
  });

  it('HTML-escapes names so family-chart cannot execute injected markup (XSS)', () => {
    const evil = '<img src=x onerror="steal()">';
    const a = addPerson(createEmptyTree('d'), { given: evil, family: 'A & B' });
    const datum = toRenderData(a.tree)[0];
    expect(datum.data['first name']).not.toContain('<img');
    expect(datum.data['first name']).toBe(
      '&lt;img src=x onerror=&quot;steal()&quot;&gt;',
    );
    expect(datum.data['last name']).toBe('A &amp; B');
  });

  it('escapes an approximate birthday label too', () => {
    const a = addPerson(createEmptyTree('d'), {
      given: 'X',
      birth: { date: '<b>1950</b>', approx: true },
    });
    expect(toRenderData(a.tree)[0].data.birthday).toBe('~&lt;b&gt;1950&lt;/b&gt;');
  });

  it('leaves avatar empty when no photo/url', () => {
    const a = addPerson(createEmptyTree('d'), { given: 'A' });
    const datum = toRenderData(a.tree)[0];
    expect(datum.data.avatar).toBe('');
    expect(datum.data._hasPhoto).toBe(false);
  });
});

describe('pickRoot', () => {
  it('returns undefined for an empty tree', () => {
    expect(pickRoot(createEmptyTree('d'))).toBeUndefined();
  });

  it('picks a top ancestor (no parents), never a descendant', () => {
    const { tree, dad, mom, kid } = familyOfThree();
    const root = pickRoot(tree);
    expect(root).not.toBe(kid); // the child is never the root
    expect([dad, mom]).toContain(root); // a parent is
  });

  it('prefers the root whose subtree covers the most people', () => {
    // Grandparent → parent → child chain vs a lone extra root.
    const gp = addPerson(createEmptyTree('d'), { given: 'GP' });
    const withParent = addChild(gp.tree, gp.person.id, { given: 'P' });
    const withKid = addChild(withParent.tree, withParent.person.id, { given: 'K' });
    const lone = addPerson(withKid.tree, { given: 'Lone' });
    // GP has 2 descendants; Lone has 0 → GP wins.
    expect(pickRoot(lone.tree)).toBe(gp.person.id);
  });
});

describe('hasRenderableData', () => {
  it('is false for an empty tree', () => {
    expect(hasRenderableData(createEmptyTree('d'))).toBe(false);
  });

  it('is true once a person exists', () => {
    const a = addPerson(createEmptyTree('d'), {});
    expect(hasRenderableData(a.tree)).toBe(true);
  });

  it('is false when the only person is soft-deleted', () => {
    const a = addPerson(createEmptyTree('d'), {});
    expect(hasRenderableData(softDeletePerson(a.tree, a.person.id))).toBe(false);
  });
});
