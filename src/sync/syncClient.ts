/**
 * SyncClient — orchestrates backup/restore/conflict against the Worker
 * (spec §6, §8). Network and timing are injectable so the decision + I/O logic
 * is unit-testable. It never merges or overwrites silently: a divergence
 * surfaces as a `pendingConflict` for the UI to resolve.
 */

import type { TreeService } from '../app/treeService';
import type { LocalStore } from '../store/localStore';
import { decideSync, type SyncDecision } from './conflict';
import { initialStatus, type SyncStatus } from './status';
import { SYNC_META_KEY, type SyncMetaRecord, type TreeMeta } from './types';
import type { WorkerApi } from './workerApi';

export interface PendingConflict {
  localRevision: number;
  remoteRevision: number;
  remoteSavedAt: string;
}

export type ConflictChoice = 'local' | 'remote' | 'both';

export interface ConflictResolution {
  /** For 'both': JSON of the other version for the UI to offer as a download. */
  downloadJson?: string;
  downloadName?: string;
}

export interface SyncClientOptions {
  service: TreeService;
  store: LocalStore;
  api: WorkerApi;
  deviceId: string;
  now?: () => Date;
  onStatus?: (status: SyncStatus) => void;
  onConflict?: (c: PendingConflict) => void;
}

export class SyncClient {
  private status: SyncStatus = initialStatus();
  private pendingConflict: PendingConflict | null = null;
  private readonly service: TreeService;
  private readonly store: LocalStore;
  private readonly api: WorkerApi;
  private readonly now: () => Date;
  private readonly onStatus: (status: SyncStatus) => void;
  private readonly onConflict: (c: PendingConflict) => void;

  constructor(opts: SyncClientOptions) {
    this.service = opts.service;
    this.store = opts.store;
    this.api = opts.api;
    this.now = opts.now ?? (() => new Date());
    this.onStatus = opts.onStatus ?? (() => {});
    this.onConflict = opts.onConflict ?? (() => {});
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  getPendingConflict(): PendingConflict | null {
    return this.pendingConflict;
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    this.onStatus(this.status);
  }

  private metaOf(): TreeMeta {
    const t = this.service.getTree();
    return { revision: t.revision, deviceId: t.deviceId, savedAt: t.savedAt };
  }

  private async readMarker(): Promise<SyncMetaRecord | null> {
    return this.store.getMeta<SyncMetaRecord>(SYNC_META_KEY);
  }

  private async writeMarker(record: SyncMetaRecord): Promise<void> {
    await this.store.setMeta(SYNC_META_KEY, record);
  }

  private treeIsEmpty(): boolean {
    return this.service.getTree().persons.length === 0;
  }

  /**
   * Evaluate on app open (or reconnect): compare local, Drive, and the last
   * sync point, then take the single safe action. Returns the decision made.
   */
  async evaluate(): Promise<SyncDecision> {
    try {
      const driveMeta = await this.api.latestMeta();
      const marker = await this.readMarker();
      const local = this.metaOf();
      const decision = decideSync(
        { revision: local.revision, deviceId: local.deviceId, isEmpty: this.treeIsEmpty() },
        driveMeta,
        marker,
      );

      switch (decision.action) {
        case 'in-sync':
          this.setStatus({
            state: 'idle',
            lastBackupAt: driveMeta?.savedAt ?? this.status.lastBackupAt,
            lastBackupRevision: driveMeta?.revision ?? this.status.lastBackupRevision,
          });
          break;
        case 'backup':
          await this.backupNow();
          break;
        case 'restore':
          await this.restoreFromDrive(driveMeta);
          break;
        case 'conflict':
          this.pendingConflict = {
            localRevision: local.revision,
            remoteRevision: driveMeta!.revision,
            remoteSavedAt: driveMeta!.savedAt,
          };
          this.onConflict(this.pendingConflict);
          break;
      }
      return decision;
    } catch (e) {
      this.setStatus({ state: this.offlineOrError(e), message: (e as Error).message });
      return { action: 'in-sync', reason: 'evaluation failed; staying local' };
    }
  }

  private offlineOrError(e: unknown): SyncStatus['state'] {
    const msg = (e as Error).message ?? '';
    // A network failure (offline) is recoverable; treat auth/other as error.
    if (/network|fetch|Failed to fetch|offline/i.test(msg)) return 'offline';
    return 'error';
  }

  /** Push the current local tree to Drive. */
  async backupNow(): Promise<void> {
    this.setStatus({ state: 'backing-up' });
    try {
      const content = await this.service.exportJson(false);
      const meta = this.metaOf();
      const result = await this.api.backup(content, meta);
      await this.writeMarker({
        syncedLocalRevision: meta.revision,
        syncedDriveRevision: result.revision,
      });
      this.setStatus({
        state: 'idle',
        lastBackupAt: this.now().toISOString(),
        lastBackupRevision: meta.revision,
      });
    } catch (e) {
      this.setStatus({ state: this.offlineOrError(e), message: (e as Error).message });
      throw e;
    }
  }

  /** Pull Drive's latest into local (new-device restore or Drive-ahead). */
  private async restoreFromDrive(driveMeta: TreeMeta | null): Promise<void> {
    this.setStatus({ state: 'backing-up' });
    const resp = await this.api.latestWithContent();
    if (!resp.content || !resp.meta) {
      this.setStatus({ state: 'idle' });
      return;
    }
    const imported = await this.service.importJson(resp.content);
    await this.writeMarker({
      syncedLocalRevision: imported.revision,
      syncedDriveRevision: resp.meta.revision,
    });
    this.setStatus({
      state: 'idle',
      lastBackupAt: (driveMeta ?? resp.meta).savedAt,
      lastBackupRevision: resp.meta.revision,
    });
  }

  /** Resolve a surfaced conflict per the user's choice (spec §6). */
  async resolveConflict(choice: ConflictChoice): Promise<ConflictResolution> {
    if (choice === 'local') {
      await this.backupNow();
      this.pendingConflict = null;
      return {};
    }
    if (choice === 'remote') {
      const driveMeta = await this.api.latestMeta();
      await this.restoreFromDrive(driveMeta);
      this.pendingConflict = null;
      return {};
    }
    // 'both': keep local as the active + Drive latest, and hand the other
    // version back to the UI to save as a file (spec §6 "keep both").
    const resp = await this.api.latestWithContent();
    await this.backupNow();
    this.pendingConflict = null;
    return {
      downloadJson: resp.content ?? undefined,
      downloadName: `family-tree-other-version-${resp.meta?.revision ?? 'x'}.json`,
    };
  }
}
