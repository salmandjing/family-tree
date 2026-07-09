/**
 * Backup status model (spec §8: no silent failures). Shared by the sync client
 * (producer) and the StatusBar (consumer). Every state has a plain-language
 * message for a non-technical user.
 */

import { t } from '../i18n';

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
    message: t.status.localOnly,
  };
}

/** Relative "il y a x min" phrasing for the status line. */
export function timeAgo(iso: string | null, now: Date = new Date()): string {
  if (!iso) return t.time.never;
  const diffMs = now.getTime() - Date.parse(iso);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return t.time.justNow;
  if (mins < 60) return t.time.min(mins);
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t.time.hr(hours);
  const days = Math.floor(hours / 24);
  return t.time.day(days);
}

/** The user-facing line for a status, combining state + last backup time. */
export function statusLine(status: SyncStatus, now: Date = new Date()): string {
  switch (status.state) {
    case 'local-only':
      return t.status.localOnly;
    case 'idle':
      return t.status.idle(timeAgo(status.lastBackupAt, now));
    case 'pending':
      return t.status.pending;
    case 'backing-up':
      return t.status.backingUp;
    case 'offline':
      return t.status.offline;
    case 'error':
      return t.status.error;
  }
}
