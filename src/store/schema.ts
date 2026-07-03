/**
 * IndexedDB schema definition for the local store (spec §4: redundancy layers
 * 1–3 — live autosave, snapshot history, soft-delete bin all live here).
 *
 * Object stores:
 *  - `tree`      : single key 'current' → the live FamilyTree working copy.
 *  - `snapshots` : ring buffer of the last N committed trees, keyed by revision.
 *  - `photos`    : photo blobs keyed by photo id (kept out of the tree document
 *                  so autosave stays cheap).
 *  - `meta`      : misc key/value (e.g. last backup info) for the sync layer.
 */

import type { DBSchema } from 'idb';
import type { FamilyTree } from '../core/types';

export const DB_NAME = 'family-tree';
export const DB_VERSION = 1;

/** How many local snapshots to retain (spec §4.2). */
export const MAX_SNAPSHOTS = 20;

/** Soft-delete bin retention window in days (spec §4.3). */
export const BIN_RETENTION_DAYS = 30;

export const STORE_TREE = 'tree';
export const STORE_SNAPSHOTS = 'snapshots';
export const STORE_PHOTOS = 'photos';
export const STORE_META = 'meta';

/** The single key under which the live tree is stored. */
export const CURRENT_TREE_KEY = 'current';

export interface StoredPhoto {
  id: string;
  personId: string;
  blob: Blob;
  mime: string;
}

export interface Snapshot {
  revision: number;
  savedAt: string;
  deviceId: string;
  tree: FamilyTree;
}

export interface FamilyTreeDB extends DBSchema {
  [STORE_TREE]: {
    key: string;
    value: FamilyTree;
  };
  [STORE_SNAPSHOTS]: {
    key: number; // revision
    value: Snapshot;
    indexes: { 'by-savedAt': string };
  };
  [STORE_PHOTOS]: {
    key: string; // photo id
    value: StoredPhoto;
    indexes: { 'by-person': string };
  };
  [STORE_META]: {
    key: string;
    value: unknown;
  };
}
