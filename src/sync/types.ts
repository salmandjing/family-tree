/** Shared sync types (kept separate to avoid import cycles). */

export interface TreeMeta {
  revision: number;
  deviceId: string;
  savedAt: string;
}

/** Persisted marker of the last successful sync point (LocalStore meta). */
export interface SyncMetaRecord {
  syncedLocalRevision: number;
  syncedDriveRevision: number;
}

export const SYNC_META_KEY = 'sync.lastSynced';
