/**
 * Sync decision logic (spec §6). Pure and side-effect-free so it can be
 * exhaustively unit-tested. Given the local state, what Drive currently holds,
 * and what we last synced, decide the ONE safe action to take.
 *
 * The guiding rule (spec §6): never silently merge, never silently overwrite.
 * When both sides changed independently we return `conflict` and let the user
 * choose.
 */

export interface LocalState {
  revision: number;
  deviceId: string;
  /** True when the local tree has no (active or deleted) people yet. */
  isEmpty: boolean;
}

export interface DriveState {
  revision: number;
  deviceId: string;
  savedAt: string;
}

/** What we recorded at the last successful backup/restore (stored in meta). */
export interface SyncMeta {
  syncedLocalRevision: number;
  syncedDriveRevision: number;
}

export type SyncAction =
  | 'in-sync' // nothing to do
  | 'backup' // local is ahead → push to Drive
  | 'restore' // Drive is ahead → pull from Drive (also new-device restore)
  | 'conflict'; // both changed since common base → ask the user

export interface SyncDecision {
  action: SyncAction;
  reason: string;
}

/**
 * Decide the sync action.
 *
 * @param local  current local state
 * @param drive  Drive's latest metadata, or null when Drive has no backup yet
 * @param meta   last-synced markers, or null on a device that never synced
 */
export function decideSync(
  local: LocalState,
  drive: DriveState | null,
  meta: SyncMeta | null,
): SyncDecision {
  // No backup exists yet on Drive.
  if (!drive) {
    if (local.isEmpty) {
      return { action: 'in-sync', reason: 'Nothing local and nothing on Drive.' };
    }
    return { action: 'backup', reason: 'Drive has no backup yet; upload local.' };
  }

  // A device that has never synced but already has local data AND Drive has data.
  if (!meta) {
    if (local.isEmpty) {
      return { action: 'restore', reason: 'Fresh device; restore from Drive.' };
    }
    // Both sides hold independent data with no common base → let user choose.
    return {
      action: 'conflict',
      reason: 'This device has its own data and Drive has a backup; no common base.',
    };
  }

  const driveChanged = drive.revision !== meta.syncedDriveRevision;
  const localChanged = local.revision !== meta.syncedLocalRevision;

  if (!driveChanged && !localChanged) {
    return { action: 'in-sync', reason: 'Both match the last sync point.' };
  }
  if (!driveChanged && localChanged) {
    return { action: 'backup', reason: 'Only local changed since last sync.' };
  }
  if (driveChanged && !localChanged) {
    return { action: 'restore', reason: 'Only Drive changed since last sync.' };
  }
  return {
    action: 'conflict',
    reason: 'Both local and Drive changed since the last sync.',
  };
}
