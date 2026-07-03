/**
 * Backup status model (spec §8: no silent failures). Shared by the sync client
 * (producer) and the StatusBar (consumer). Every state has a plain-language
 * message for a non-technical user.
 */

export type SyncState =
  | 'local-only' // backup not configured / no passphrase yet
  | 'idle' // up to date with Drive
  | 'pending' // edits waiting for the debounce window
  | 'backing-up' // upload in progress
  | 'error' // backup is failing — loud, red
  | 'offline'; // no network; will retry

export interface SyncStatus {
  state: SyncState;
  /** ISO timestamp of the last successful backup, if any. */
  lastBackupAt: string | null;
  /** Revision last successfully backed up. */
  lastBackupRevision: number | null;
  /** Human-readable detail for the current state. */
  message: string;
}

export function initialStatus(): SyncStatus {
  return {
    state: 'local-only',
    lastBackupAt: null,
    lastBackupRevision: null,
    message: 'Saved on this device',
  };
}

/** Relative "x minutes ago" phrasing for the status line. */
export function timeAgo(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'never';
  const diffMs = now.getTime() - Date.parse(iso);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** The user-facing line for a status, combining state + last backup time. */
export function statusLine(status: SyncStatus, now: Date = new Date()): string {
  switch (status.state) {
    case 'local-only':
      return 'Saved on this device';
    case 'idle':
      return `✓ Backed up ${timeAgo(status.lastBackupAt, now)}`;
    case 'pending':
      return 'Changes saved here — backing up shortly…';
    case 'backing-up':
      return 'Backing up…';
    case 'offline':
      return 'Offline — your changes are saved here and will back up when you reconnect';
    case 'error':
      return 'Backups stopped working — your changes are still saved on this device. Tell Salman.';
  }
}
