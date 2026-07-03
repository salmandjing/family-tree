/**
 * Immutable operations on a FamilyTree.
 *
 * Every function returns a NEW tree; none mutate their input (spec §3, §coding
 * style). Every operation that changes data goes through `commit`, which bumps
 * `revision` and stamps `savedAt` so the redundancy/sync layers can rely on a
 * monotonic revision.
 */

import { newId } from './ids';
import { createPerson, createUnion, type NewPersonInput } from './factories';
import type {
  FamilyTree,
  Person,
  Union,
  UnionChild,
  UnionStatus,
  ChildRelation,
} from './types';

/** Injectable clock, so tests get deterministic `savedAt` values. */
export type Clock = () => Date;
const systemClock: Clock = () => new Date();

/**
 * Produce a new tree from `patch`, bumping revision and stamping savedAt.
 * This is the single choke point through which all mutations flow.
 */
export function commit(
  tree: FamilyTree,
  patch: Partial<Pick<FamilyTree, 'persons' | 'unions' | 'photos'>>,
  clock: Clock = systemClock,
): FamilyTree {
  return {
    ...tree,
    ...patch,
    revision: tree.revision + 1,
    savedAt: clock().toISOString(),
  };
}

// ── Lookups (pure, no commit) ────────────────────────────────────────────────

export function getPerson(tree: FamilyTree, id: string): Person | undefined {
  return tree.persons.find((p) => p.id === id);
}

export function getUnion(tree: FamilyTree, id: string): Union | undefined {
  return tree.unions.find((u) => u.id === id);
}

/** Active persons = not soft-deleted. */
export function activePersons(tree: FamilyTree): Person[] {
  return tree.persons.filter((p) => p.deletedAt === null);
}

/** Soft-deleted persons (the "Recently deleted" bin, spec §4.3). */
export function deletedPersons(tree: FamilyTree): Person[] {
  return tree.persons.filter((p) => p.deletedAt !== null);
}

// ── Person operations ────────────────────────────────────────────────────────

export function addPerson(
  tree: FamilyTree,
  input: NewPersonInput = {},
  clock?: Clock,
): { tree: FamilyTree; person: Person } {
  const person = createPerson(input);
  const next = commit(tree, { persons: [...tree.persons, person] }, clock);
  return { tree: next, person };
}

/** Insert an already-built person (used by restore/import flows). */
export function insertPerson(
  tree: FamilyTree,
  person: Person,
  clock?: Clock,
): FamilyTree {
  if (getPerson(tree, person.id)) {
    throw new Error(`Person ${person.id} already exists`);
  }
  return commit(tree, { persons: [...tree.persons, person] }, clock);
}

/**
 * Update a person via an updater that receives the current person and returns
 * a new one. The updater must not mutate its argument.
 */
export function updatePerson(
  tree: FamilyTree,
  id: string,
  updater: (p: Person) => Person,
  clock?: Clock,
): FamilyTree {
  const existing = getPerson(tree, id);
  if (!existing) throw new Error(`Person ${id} not found`);
  const updated = updater(existing);
  if (updated.id !== id) throw new Error('Updater must not change person id');
  return commit(
    tree,
    { persons: tree.persons.map((p) => (p.id === id ? updated : p)) },
    clock,
  );
}

/** Convenience: shallow-merge fields into a person. */
export function patchPerson(
  tree: FamilyTree,
  id: string,
  fields: Partial<Omit<Person, 'id'>>,
  clock?: Clock,
): FamilyTree {
  return updatePerson(tree, id, (p) => ({ ...p, ...fields }), clock);
}

/**
 * Soft-delete: move a person to the "Recently deleted" bin (spec §4.3).
 * Their links remain intact so a restore is lossless. Idempotent.
 */
export function softDeletePerson(
  tree: FamilyTree,
  id: string,
  clock: Clock = systemClock,
): FamilyTree {
  const existing = getPerson(tree, id);
  if (!existing) throw new Error(`Person ${id} not found`);
  if (existing.deletedAt !== null) return tree; // already binned, no-op
  const deletedAt = clock().toISOString();
  return updatePerson(tree, id, (p) => ({ ...p, deletedAt }), clock);
}

/** Restore a soft-deleted person from the bin. Idempotent. */
export function restorePerson(
  tree: FamilyTree,
  id: string,
  clock?: Clock,
): FamilyTree {
  const existing = getPerson(tree, id);
  if (!existing) throw new Error(`Person ${id} not found`);
  if (existing.deletedAt === null) return tree;
  return updatePerson(tree, id, (p) => ({ ...p, deletedAt: null }), clock);
}

/**
 * Permanently remove a person and scrub all references to them from unions
 * (drops them from partner lists and children lists, and removes any union
 * left with no partners and no children). Used by bin cleanup after retention
 * or by explicit "delete forever".
 */
export function purgePerson(
  tree: FamilyTree,
  id: string,
  clock?: Clock,
): FamilyTree {
  const persons = tree.persons.filter((p) => p.id !== id);
  const unions = tree.unions
    .map((u) => ({
      ...u,
      partners: u.partners.filter((pid) => pid !== id),
      children: u.children.filter((c) => c.personId !== id),
    }))
    .filter((u) => u.partners.length > 0 || u.children.length > 0);
  // Drop photo records belonging to the purged person so their blobs can be
  // garbage-collected from the local store.
  const photos = tree.photos.filter((ph) => ph.personId !== id);
  return commit(tree, { persons, unions, photos }, clock);
}

// ── Union operations ─────────────────────────────────────────────────────────

export function addUnion(
  tree: FamilyTree,
  partners: string[] = [],
  status: UnionStatus = 'unknown',
  clock?: Clock,
): { tree: FamilyTree; union: Union } {
  for (const pid of partners) {
    if (!getPerson(tree, pid)) throw new Error(`Partner ${pid} not found`);
  }
  const union = createUnion({ partners, status });
  const next = commit(tree, { unions: [...tree.unions, union] }, clock);
  return { tree: next, union };
}

export function insertUnion(
  tree: FamilyTree,
  union: Union,
  clock?: Clock,
): FamilyTree {
  if (getUnion(tree, union.id)) {
    throw new Error(`Union ${union.id} already exists`);
  }
  return commit(tree, { unions: [...tree.unions, union] }, clock);
}

export function updateUnion(
  tree: FamilyTree,
  id: string,
  updater: (u: Union) => Union,
  clock?: Clock,
): FamilyTree {
  const existing = getUnion(tree, id);
  if (!existing) throw new Error(`Union ${id} not found`);
  const updated = updater(existing);
  if (updated.id !== id) throw new Error('Updater must not change union id');
  return commit(
    tree,
    { unions: tree.unions.map((u) => (u.id === id ? updated : u)) },
    clock,
  );
}

export function setUnionStatus(
  tree: FamilyTree,
  id: string,
  status: UnionStatus,
  clock?: Clock,
): FamilyTree {
  return updateUnion(tree, id, (u) => ({ ...u, status }), clock);
}

export function addPartnerToUnion(
  tree: FamilyTree,
  unionId: string,
  personId: string,
  clock?: Clock,
): FamilyTree {
  if (!getPerson(tree, personId)) throw new Error(`Person ${personId} not found`);
  return updateUnion(
    tree,
    unionId,
    (u) =>
      u.partners.includes(personId)
        ? u
        : { ...u, partners: [...u.partners, personId] },
    clock,
  );
}

export function addChildToUnion(
  tree: FamilyTree,
  unionId: string,
  personId: string,
  relation: ChildRelation = 'biological',
  clock?: Clock,
): FamilyTree {
  if (!getPerson(tree, personId)) throw new Error(`Person ${personId} not found`);
  return updateUnion(
    tree,
    unionId,
    (u) => {
      if (u.children.some((c) => c.personId === personId)) return u;
      const child: UnionChild = { personId, relation };
      return { ...u, children: [...u.children, child] };
    },
    clock,
  );
}

export function removeChildFromUnion(
  tree: FamilyTree,
  unionId: string,
  personId: string,
  clock?: Clock,
): FamilyTree {
  return updateUnion(
    tree,
    unionId,
    (u) => ({
      ...u,
      children: u.children.filter((c) => c.personId !== personId),
    }),
    clock,
  );
}

// ── Photo record operations (metadata in the tree; blobs in the local store) ─

/**
 * Register a photo: appends a metadata record to `tree.photos` and links it to
 * the person (first photo becomes primary). The blob itself is written to the
 * local store separately (spec §5 — no blob/base64 in the working data).
 */
export function addPhotoRecord(
  tree: FamilyTree,
  photo: { id: string; personId: string; mime: string },
  clock?: Clock,
): FamilyTree {
  if (!getPerson(tree, photo.personId)) {
    throw new Error(`Person ${photo.personId} not found`);
  }
  if (tree.photos.some((p) => p.id === photo.id)) {
    throw new Error(`Photo ${photo.id} already exists`);
  }
  const withRecord = commit(
    tree,
    { photos: [...tree.photos, { id: photo.id, personId: photo.personId, mime: photo.mime }] },
    clock,
  );
  return attachPhotoToPerson(withRecord, photo.personId, photo.id, clock);
}

/** Remove a photo record from the tree and unlink it from its person. */
export function removePhotoRecord(
  tree: FamilyTree,
  photoId: string,
  clock?: Clock,
): FamilyTree {
  const record = tree.photos.find((p) => p.id === photoId);
  const withoutRecord = commit(
    tree,
    { photos: tree.photos.filter((p) => p.id !== photoId) },
    clock,
  );
  if (!record) return withoutRecord;
  return detachPhotoFromPerson(withoutRecord, record.personId, photoId, clock);
}

// ── Photo reference operations (blob storage lives in the local store) ────────

/** Attach a photo id to a person. First photo becomes the primary/face photo. */
export function attachPhotoToPerson(
  tree: FamilyTree,
  personId: string,
  photoId: string,
  clock?: Clock,
): FamilyTree {
  return updatePerson(
    tree,
    personId,
    (p) => (p.photos.includes(photoId) ? p : { ...p, photos: [...p.photos, photoId] }),
    clock,
  );
}

export function detachPhotoFromPerson(
  tree: FamilyTree,
  personId: string,
  photoId: string,
  clock?: Clock,
): FamilyTree {
  return updatePerson(
    tree,
    personId,
    (p) => ({ ...p, photos: p.photos.filter((id) => id !== photoId) }),
    clock,
  );
}

/** Make an already-attached photo the primary (first) one. */
export function setPrimaryPhoto(
  tree: FamilyTree,
  personId: string,
  photoId: string,
  clock?: Clock,
): FamilyTree {
  return updatePerson(
    tree,
    personId,
    (p) => {
      if (!p.photos.includes(photoId)) return p;
      const rest = p.photos.filter((id) => id !== photoId);
      return { ...p, photos: [photoId, ...rest] };
    },
    clock,
  );
}

// ── Bin retention ────────────────────────────────────────────────────────────

/** IDs of soft-deleted persons whose retention window has elapsed. */
export function expiredBinPersonIds(
  tree: FamilyTree,
  retentionDays: number,
  now: Date,
): string[] {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return tree.persons
    .filter((p) => p.deletedAt !== null && Date.parse(p.deletedAt) <= cutoff)
    .map((p) => p.id);
}

/**
 * Permanently remove soft-deleted persons past the retention window (spec §4.3,
 * 30-day bin). Returns the same tree object when nothing expired, so callers can
 * skip a redundant save.
 */
export function purgeExpiredBin(
  tree: FamilyTree,
  retentionDays: number,
  now: Date,
  clock?: Clock,
): FamilyTree {
  const expired = expiredBinPersonIds(tree, retentionDays, now);
  if (expired.length === 0) return tree;
  return expired.reduce((acc, id) => purgePerson(acc, id, clock), tree);
}

/** Generate a fresh id — re-exported so callers needn't import ids.ts. */
export { newId };
