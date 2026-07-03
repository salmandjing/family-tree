/**
 * TreeService — the application core that the UI talks to. Framework-agnostic
 * and observable (subscribe/notify) so it can be unit-tested without React and
 * driven by a thin hook in the UI.
 *
 * It owns:
 *  - the live tree (in memory), mirrored to the LocalStore on every change;
 *  - undo/redo stacks (spec §4.3, in-session);
 *  - photo intake (compress → store blob → record) and avatar object URLs;
 *  - export/import wiring to the serializer;
 *  - the "Recently deleted" bin operations.
 *
 * Revision monotonicity (spec §3) is preserved even across undo/redo: undo
 * re-commits prior content as a NEW higher revision rather than moving the
 * number backwards.
 */

import { createEmptyTree } from '../core/factories';
import { getDeviceId, newId } from '../core/ids';
import {
  addPhotoRecord,
  commit,
  removePhotoRecord,
  restorePerson,
  softDeletePerson,
  purgePerson,
  type Clock,
} from '../core/operations';
import { serializeToJson, deserializeFromJson } from '../core/serializer';
import type { FamilyTree } from '../core/types';
import { LocalStore } from '../store/localStore';
import { BIN_RETENTION_DAYS } from '../store/schema';
import {
  preparePhoto,
  type Compressor,
  browserCompressor,
} from './photoService';

const MAX_HISTORY = 50;

type Listener = () => void;

export interface TreeServiceOptions {
  store: LocalStore;
  deviceId?: string;
  compressor?: Compressor;
  clock?: Clock;
  now?: () => Date;
}

export class TreeService {
  private tree: FamilyTree;
  private undoStack: FamilyTree[] = [];
  private redoStack: FamilyTree[] = [];
  private listeners = new Set<Listener>();
  private avatarUrls = new Map<string, string>();
  private readonly store: LocalStore;
  private readonly deviceId: string;
  private readonly compressor: Compressor;
  private readonly clock: Clock;
  private readonly now: () => Date;

  constructor(opts: TreeServiceOptions) {
    this.store = opts.store;
    this.deviceId = opts.deviceId ?? getDeviceId();
    this.compressor = opts.compressor ?? browserCompressor;
    this.clock = opts.clock ?? (() => new Date());
    this.now = opts.now ?? (() => new Date());
    this.tree = createEmptyTree(this.deviceId);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Load the persisted tree (or create an empty one) and clean the bin. */
  async init(): Promise<void> {
    const loaded = await this.store.loadTree();
    this.tree = loaded ?? createEmptyTree(this.deviceId);
    if (!loaded) {
      // First run: persist the empty tree so a snapshot exists immediately.
      await this.store.saveTree(this.tree);
    }
    // Retire anything past the bin retention window on startup.
    const cleaned = await this.store.cleanupBin(
      this.tree,
      this.now(),
      BIN_RETENTION_DAYS,
    );
    if (cleaned !== this.tree) this.tree = cleaned;
    this.notify();
  }

  // ── Observation ────────────────────────────────────────────────────────────

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  getTree(): FamilyTree {
    return this.tree;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // ── Committing changes ─────────────────────────────────────────────────────

  /**
   * Apply an immutable mutation, persist it, and record it for undo. The
   * mutator receives the current tree and MUST return a committed new tree
   * (use core operations, which bump revision). Returns the new tree.
   */
  async apply(
    mutator: (tree: FamilyTree, clock: Clock) => FamilyTree,
  ): Promise<FamilyTree> {
    const prev = this.tree;
    const next = mutator(prev, this.clock);
    if (next === prev) return prev; // no-op mutation, skip save
    this.undoStack.push(prev);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.tree = next;
    await this.store.saveTree(next);
    this.notify();
    return next;
  }

  /** Restore prior content as a new higher revision (keeps revision monotonic). */
  private async restoreContent(target: FamilyTree): Promise<void> {
    const restored = commit(
      this.tree,
      {
        persons: target.persons,
        unions: target.unions,
        photos: target.photos,
      },
      this.clock,
    );
    this.tree = restored;
    await this.store.saveTree(restored);
    this.notify();
  }

  async undo(): Promise<void> {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.tree);
    await this.restoreContent(prev);
  }

  async redo(): Promise<void> {
    const target = this.redoStack.pop();
    if (!target) return;
    this.undoStack.push(this.tree);
    await this.restoreContent(target);
  }

  // ── Snapshots (History screen) ─────────────────────────────────────────────

  async listSnapshots() {
    return this.store.listSnapshots();
  }

  /** Restore a snapshot's content as a new higher revision (spec §4.2). */
  async restoreSnapshot(revision: number): Promise<void> {
    const snap = await this.store.getSnapshot(revision);
    if (!snap) throw new Error('That snapshot no longer exists.');
    this.undoStack.push(this.tree);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    await this.restoreContent(snap.tree);
  }

  // ── Soft-delete / bin ──────────────────────────────────────────────────────

  async deletePerson(id: string): Promise<void> {
    await this.apply((t, clock) => softDeletePerson(t, id, clock));
  }

  async restoreDeletedPerson(id: string): Promise<void> {
    await this.apply((t, clock) => restorePerson(t, id, clock));
  }

  /** Permanently delete from the bin now, cleaning up photo blobs. */
  async purgePersonNow(id: string): Promise<void> {
    const photoIds = this.tree.photos
      .filter((p) => p.personId === id)
      .map((p) => p.id);
    await this.apply((t, clock) => purgePerson(t, id, clock));
    for (const pid of photoIds) {
      this.revokeAvatarUrl(pid);
      await this.store.deletePhotoBlob(pid);
    }
  }

  // ── Photos ─────────────────────────────────────────────────────────────────

  /**
   * Add a photo to a person: compress, store the blob, register the record.
   * Returns the new photo id.
   */
  async addPhoto(personId: string, file: Blob): Promise<string> {
    const { blob, mime } = await preparePhoto(file, this.compressor);
    const photoId = newId();
    await this.store.putPhotoBlob({ id: photoId, personId, mime, blob });
    await this.apply((t, clock) =>
      addPhotoRecord(t, { id: photoId, personId, mime }, clock),
    );
    return photoId;
  }

  async removePhoto(photoId: string): Promise<void> {
    await this.apply((t, clock) => removePhotoRecord(t, photoId, clock));
    this.revokeAvatarUrl(photoId);
    await this.store.deletePhotoBlob(photoId);
  }

  /** Lazily build (and cache) an object URL for a photo blob, for <img src>. */
  async getAvatarUrl(photoId: string): Promise<string | null> {
    const cached = this.avatarUrls.get(photoId);
    if (cached) return cached;
    const stored = await this.store.getPhotoBlob(photoId);
    if (!stored) return null;
    const url = URL.createObjectURL(stored.blob);
    this.avatarUrls.set(photoId, url);
    return url;
  }

  /** Snapshot of currently-cached avatar URLs, for the render adapter. */
  avatarUrlMap(): Map<string, string> {
    return new Map(this.avatarUrls);
  }

  private revokeAvatarUrl(photoId: string): void {
    const url = this.avatarUrls.get(photoId);
    if (url) {
      URL.revokeObjectURL(url);
      this.avatarUrls.delete(photoId);
    }
  }

  /** Release all object URLs and close the store (call on teardown). */
  dispose(): void {
    for (const url of this.avatarUrls.values()) URL.revokeObjectURL(url);
    this.avatarUrls.clear();
    this.listeners.clear();
    this.store.close();
  }

  // ── Export / Import ──────────────────────────────────────────────────────��─

  /** Serialize the whole tree (photos hydrated as base64) to a JSON string. */
  async exportJson(pretty = true): Promise<string> {
    const hydrated = await this.store.hydrateForExport(this.tree);
    return serializeToJson(hydrated, pretty);
  }

  /**
   * Import a tree from a JSON string, replacing the current tree. Blobs are
   * written to the photo store; the tree document is dehydrated. Validated by
   * the serializer (throws on invalid input).
   */
  async importJson(json: string): Promise<FamilyTree> {
    const incoming = await deserializeFromJson(json);
    const persisted = await this.store.persistImportedTree(incoming);
    this.undoStack.push(this.tree);
    this.redoStack = [];
    this.tree = persisted;
    this.notify();
    return persisted;
  }
}
