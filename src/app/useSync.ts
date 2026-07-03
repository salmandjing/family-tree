/**
 * useSync — wires the SyncClient into React (spec §4.4, §6, §8). On mount it
 * evaluates against Drive; on every edit it debounces a backup (2 min after the
 * last change); on tab-hide it flushes best-effort with a keepalive request.
 * Exposes live status, any pending conflict, and resolution controls.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalStore, useTreeService } from './TreeContext';
import { backupEnabled, getStoredPassphrase, workerUrl } from './config';
import { getDeviceId } from '../core/ids';
import { HttpWorkerApi } from '../sync/workerApi';
import {
  SyncClient,
  type PendingConflict,
  type ConflictChoice,
} from '../sync/syncClient';
import { initialStatus, type SyncStatus } from '../sync/status';

const BACKUP_DEBOUNCE_MS = 2 * 60 * 1000; // spec §4.4

export interface UseSync {
  status: SyncStatus;
  conflict: PendingConflict | null;
  resolveConflict: (choice: ConflictChoice) => Promise<void>;
  retry: () => void;
}

export function useSync(): UseSync {
  const service = useTreeService();
  const store = useLocalStore();
  const [status, setStatus] = useState<SyncStatus>(initialStatus());
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  const clientRef = useRef<SyncClient | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBackedRevision = useRef<number>(-1);

  // Build the client once (only when backup is configured + unlocked).
  useEffect(() => {
    const url = workerUrl();
    const passphrase = getStoredPassphrase();
    if (!backupEnabled() || !url || !passphrase) return;

    const api = new HttpWorkerApi(url, passphrase);
    const client = new SyncClient({
      service,
      store,
      api,
      deviceId: getDeviceId(),
      onStatus: setStatus,
      onConflict: setConflict,
    });
    clientRef.current = client;
    client.evaluate();

    return () => {
      clientRef.current = null;
    };
  }, [service, store]);

  const scheduleBackup = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    setStatus((s) => ({ ...s, state: 'pending' }));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      client.backupNow().catch(() => {
        /* status already reflects the failure */
      });
    }, BACKUP_DEBOUNCE_MS);
  }, []);

  // Debounced backup on every committed edit.
  useEffect(() => {
    const unsub = service.subscribe(() => {
      const client = clientRef.current;
      if (!client) return;
      const rev = service.getTree().revision;
      if (rev !== lastBackedRevision.current) {
        lastBackedRevision.current = rev;
        scheduleBackup();
      }
    });
    return unsub;
  }, [service, scheduleBackup]);

  // Best-effort flush when the tab is hidden/closed.
  useEffect(() => {
    const onHide = () => {
      const client = clientRef.current;
      if (!client) return;
      if (document.visibilityState === 'hidden') {
        client.backupNow().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  const resolveConflict = useCallback(async (choice: ConflictChoice) => {
    const client = clientRef.current;
    if (!client) return;
    const res = await client.resolveConflict(choice);
    setConflict(null);
    if (res.downloadJson) {
      const blob = new Blob([res.downloadJson], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = res.downloadName ?? 'family-tree-other-version.json';
      a.click();
      URL.revokeObjectURL(href);
    }
  }, []);

  const retry = useCallback(() => {
    clientRef.current?.backupNow().catch(() => {});
  }, []);

  return { status, conflict, resolveConflict, retry };
}
