/**
 * Low-level IndexedDB connection via `idb`. Kept tiny and separate so the
 * higher-level LocalStore (localStore.ts) can be tested against a fresh DB.
 */

import { openDB, type IDBPDatabase } from 'idb';
import {
  DB_NAME,
  DB_VERSION,
  STORE_META,
  STORE_PHOTOS,
  STORE_SNAPSHOTS,
  STORE_TREE,
  type FamilyTreeDB,
} from './schema';

export type DB = IDBPDatabase<FamilyTreeDB>;

export function openTreeDB(name: string = DB_NAME): Promise<DB> {
  return openDB<FamilyTreeDB>(name, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_TREE)) {
        db.createObjectStore(STORE_TREE);
      }
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        const snaps = db.createObjectStore(STORE_SNAPSHOTS, {
          keyPath: 'revision',
        });
        snaps.createIndex('by-savedAt', 'savedAt');
      }
      if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
        const photos = db.createObjectStore(STORE_PHOTOS, { keyPath: 'id' });
        photos.createIndex('by-person', 'personId');
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
    },
  });
}
