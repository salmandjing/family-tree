/**
 * Core domain types for the family tree.
 *
 * The tree is modeled as a GRAPH, not a binary tree: `persons` are nodes and
 * `unions` connect partners and group their children. This supports polygamy,
 * remarriage/divorce, and adopted/step/half relationships natively (spec §3).
 *
 * All data here is treated as immutable. Operations in `operations.ts` return
 * new objects rather than mutating in place (spec §3, coding-style).
 */

export const SCHEMA_VERSION = 1 as const;

export type Sex = 'M' | 'F' | 'unknown';

export type UnionStatus =
  | 'married'
  | 'divorced'
  | 'separated'
  | 'partner'
  | 'unknown';

export type ChildRelation =
  | 'biological'
  | 'adopted'
  | 'step'
  | 'foster'
  | 'unknown';

/** A date is a free-text string with an "approximate" flag (spec §3). */
export interface LifeEvent {
  /** e.g. "1950", "1950-03", "around Christmas 1950". `null` = unknown. */
  date: string | null;
  /** true when the date is a guess ("around 1950"). */
  approx: boolean;
  place: string;
}

export interface PersonName {
  given: string;
  family: string;
  nicknames: string[];
}

export interface Person {
  id: string;
  name: PersonName;
  sex: Sex;
  birth: LifeEvent;
  death: LifeEvent; // date === null means living
  /** Privacy flag for any future public sharing. */
  living: boolean;
  /** Free-text stories — a first-class field, not buried. */
  notes: string;
  /** Photo IDs; first entry is the primary/face photo. */
  photos: string[];
  /** ISO timestamp when soft-deleted, or null if active. */
  deletedAt: string | null;
}

export interface UnionChild {
  personId: string;
  relation: ChildRelation;
}

export interface Union {
  id: string;
  /** Usually two partners, but modeled as a list for flexibility. */
  partners: string[];
  status: UnionStatus;
  children: UnionChild[];
}

/**
 * A photo. At runtime `blob` holds the image; `data`/`mime` are only populated
 * by the serializer for export (spec §5). Exactly one of blob/data is present
 * depending on context.
 */
export interface Photo {
  id: string;
  personId: string;
  /** Runtime image data (IndexedDB). Absent in serialized form. */
  blob?: Blob;
  /** base64 image data. Only present in serialized/exported form. */
  data?: string;
  mime: string;
}

/**
 * The full family tree document — the unit that is saved, snapshotted, and
 * backed up. `revision` is monotonic and bumped on every committed change.
 */
export interface FamilyTree {
  schemaVersion: typeof SCHEMA_VERSION;
  /** Monotonic, incremented every save. */
  revision: number;
  /** Device that produced this revision. */
  deviceId: string;
  /** ISO timestamp of last save. */
  savedAt: string;
  persons: Person[];
  unions: Union[];
  /** At runtime photos live in IndexedDB, not here; this is used by serializer. */
  photos: Photo[];
}

/** Which slot on a union a person occupies — used by relationship helpers. */
export type UnionRole = 'partner' | 'child';
