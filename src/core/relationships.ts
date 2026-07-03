/**
 * Higher-level relationship operations and graph queries.
 *
 * The "big buttons" from spec §9 (Add parent / Add spouse / Add child) are
 * composed here from the primitives in operations.ts. Graph queries (parents,
 * children, spouses, siblings) feed both the UI and the renderer adapter.
 */

import type { NewPersonInput } from './factories';
import {
  addChildToUnion,
  addPartnerToUnion,
  addPerson,
  addUnion,
  getPerson,
  getUnion,
  type Clock,
} from './operations';
import type { ChildRelation, FamilyTree, Person, Union } from './types';

// ── Graph queries ────────────────────────────────────────────────────────────

/** Unions in which `personId` is a partner. */
export function unionsAsPartner(tree: FamilyTree, personId: string): Union[] {
  return tree.unions.filter((u) => u.partners.includes(personId));
}

/** The (usually single) union in which `personId` appears as a child. */
export function unionsAsChild(tree: FamilyTree, personId: string): Union[] {
  return tree.unions.filter((u) =>
    u.children.some((c) => c.personId === personId),
  );
}

/** Partner ids sharing a union with `personId` (excludes the person itself). */
export function spouseIds(tree: FamilyTree, personId: string): string[] {
  const ids = new Set<string>();
  for (const u of unionsAsPartner(tree, personId)) {
    for (const pid of u.partners) if (pid !== personId) ids.add(pid);
  }
  return [...ids];
}

/** All children of `personId` across every union they partner in. */
export function childIds(tree: FamilyTree, personId: string): string[] {
  const ids = new Set<string>();
  for (const u of unionsAsPartner(tree, personId)) {
    for (const c of u.children) ids.add(c.personId);
  }
  return [...ids];
}

/** Parents of `personId` (partners of the union(s) they are a child of). */
export function parentIds(tree: FamilyTree, personId: string): string[] {
  const ids = new Set<string>();
  for (const u of unionsAsChild(tree, personId)) {
    for (const pid of u.partners) ids.add(pid);
  }
  return [...ids];
}

/**
 * Siblings of `personId`: other children in the same parent union(s).
 * Half-siblings fall out naturally because they share only one parent union.
 */
export function siblingIds(tree: FamilyTree, personId: string): string[] {
  const ids = new Set<string>();
  for (const u of unionsAsChild(tree, personId)) {
    for (const c of u.children) if (c.personId !== personId) ids.add(c.personId);
  }
  return [...ids];
}

// ── "Big button" composed operations (spec §9) ──────────────────────────────

/**
 * Add a spouse/partner to `personId`. Creates the new person and a union
 * linking the two. Returns the new person and the union so the UI can react.
 */
export function addSpouse(
  tree: FamilyTree,
  personId: string,
  input: NewPersonInput = {},
  status: Union['status'] = 'married',
  clock?: Clock,
): { tree: FamilyTree; person: Person; union: Union } {
  if (!getPerson(tree, personId)) throw new Error(`Person ${personId} not found`);
  const added = addPerson(tree, input, clock);
  const withUnion = addUnion(
    added.tree,
    [personId, added.person.id],
    status,
    clock,
  );
  return { tree: withUnion.tree, person: added.person, union: withUnion.union };
}

/**
 * Add a child to `personId`. If a `unionId` is given, the child joins that
 * union. Otherwise: if the person partners in exactly one union, that one is
 * used; if they have none, a solo union is created; if they have several the
 * caller MUST pass `unionId` (ambiguous — polygamy case), else we throw.
 */
export function addChild(
  tree: FamilyTree,
  personId: string,
  input: NewPersonInput = {},
  opts: { unionId?: string; relation?: ChildRelation } = {},
  clock?: Clock,
): { tree: FamilyTree; person: Person; union: Union } {
  if (!getPerson(tree, personId)) throw new Error(`Person ${personId} not found`);

  let workingTree = tree;
  let unionId = opts.unionId;

  if (unionId) {
    const u = getUnion(workingTree, unionId);
    if (!u) throw new Error(`Union ${unionId} not found`);
    if (!u.partners.includes(personId)) {
      throw new Error(`Person ${personId} is not a partner in union ${unionId}`);
    }
  } else {
    const partnered = unionsAsPartner(workingTree, personId);
    if (partnered.length > 1) {
      throw new Error(
        `Person ${personId} has multiple unions; specify which one to add the child to`,
      );
    }
    if (partnered.length === 1) {
      unionId = partnered[0].id;
    } else {
      const created = addUnion(workingTree, [personId], 'unknown', clock);
      workingTree = created.tree;
      unionId = created.union.id;
    }
  }

  const added = addPerson(workingTree, input, clock);
  const withChild = addChildToUnion(
    added.tree,
    unionId,
    added.person.id,
    opts.relation ?? 'biological',
    clock,
  );
  const union = getUnion(withChild, unionId)!;
  return { tree: withChild, person: added.person, union };
}

/**
 * Add a parent to `personId`. The person becomes (or stays) a child of a
 * "parent union". If they already have a parent union with room, the new
 * parent joins it (covers "add the second parent"); otherwise a new parent
 * union is created with `personId` as its child.
 */
export function addParent(
  tree: FamilyTree,
  personId: string,
  input: NewPersonInput = {},
  clock?: Clock,
): { tree: FamilyTree; person: Person; union: Union } {
  if (!getPerson(tree, personId)) throw new Error(`Person ${personId} not found`);

  const existingParentUnions = unionsAsChild(tree, personId);
  const added = addPerson(tree, input, clock);

  // Prefer joining an existing parent union that has fewer than 2 partners.
  const joinable = existingParentUnions.find((u) => u.partners.length < 2);
  if (joinable) {
    const withPartner = addPartnerToUnion(
      added.tree,
      joinable.id,
      added.person.id,
      clock,
    );
    const union = getUnion(withPartner, joinable.id)!;
    return { tree: withPartner, person: added.person, union };
  }

  // Otherwise create a new parent union with this person as a child.
  const created = addUnion(added.tree, [added.person.id], 'unknown', clock);
  const withChild = addChildToUnion(
    created.tree,
    created.union.id,
    personId,
    'biological',
    clock,
  );
  const union = getUnion(withChild, created.union.id)!;
  return { tree: withChild, person: added.person, union };
}
