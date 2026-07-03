/**
 * LocalStore — the browser-side storage of record (spec §4 layers 1–3).
 *
 * Responsibilities:
 *  - Persist the live tree on every committed edit (autosave).
 *  - Keep a ring buffer of the last MAX_SNAPSHOTS committed trees.
 *  - Store photo blobs separately from the tree document.
 *  - Hydrate/dehydrate photos when exporting/importing whole trees.
 *  - Provide the "Recently deleted" bin cleanup.
 *
 * All methods are async (IndexedDB). The class owns a single DB connection.
 */

import type { FamilyTree } from '../core/types';
import { purgeExpiredBin } from '../core/operations';
import { openTreeDB, type DB } from './db';
import {
  BIN_RETENTION_DAYS,
  CURRENT_TREE_KEY,
  MAX_SNAPSHOTS,
  STORE_META,
  STORE_PHOTOS,
  STORE_SNAPSHOTS,
  STORE_TREE,
  type Snapshot,
  type StoredPhoto,
} from './schema';

export class LocalStore {
  private constructor(private readonly db: DB) {}

  static async open(dbName?: string): Promise<LocalStore> {
    const db = await openTreeDB(dbName);
    return new LocalStore(db);
  }

  close(): void {
    this.db.close();
  }

  // ── Tree persistence + snapshots ───────────────────────────────────────────

  /** The live working tree, or null on first run. */
  async loadTree(): Promise<FamilyTree | null> {
    const tree = await this.db.get(STORE_TREE, CURRENT_TREE_KEY);
    return tree ?? null;
  }

  /**
   * Persist the tree as the live copy AND record a snapshot, then prune the
   * snapshot ring to MAX_SNAPSHOTS. Done in a single transaction so a crash
   * mid-save never leaves the live copy and snapshot list inconsistent.
   */
  async saveTree(tree: FamilyTree): Promise<void> {
    const tx = this.db.transaction([STORE_TREE, STORE_SNAPSHOTS], 'readwrite');
    const treeStore = tx.objectStore(STORE_TREE);
    const snapStore = tx.objectStore(STORE_SNAPSHOTS);

    await treeStore.put(tree, CURRENT_TREE_KEY);

    const snapshot: Snapshot = {
      revision: tree.revision,
      savedAt: tree.savedAt,
      deviceId: tree.deviceId,
      tree,
    };
    await snapStore.put(snapshot);

    // Prune oldest snapshots beyond the retention count.
    let count = await snapStore.count();
    if (count > MAX_SNAPSHOTS) {
      // Keys are revisions (numbers); iterate ascending and delete the oldest.
      let cursor = await snapStore.openCursor();
      while (cursor && count > MAX_SNAPSHOTS) {
        await cursor.delete();
        count--;
        cursor = await cursor.continue();
      }
    }

    await tx.done;
  }

  /** Snapshots, newest first (spec §4.2 "History" screen). */
  async listSnapshots(): Promise<Snapshot[]> {
    const all = await this.db.getAll(STORE_SNAPSHOTS);
    return all.sort((a, b) => b.revision - a.revision);
  }

  async getSnapshot(revision: number): Promise<Snapshot | null> {
    return (await this.db.get(STORE_SNAPSHOTS, revision)) ?? null;
  }

  // ── Photo blobs ────────────────────────────────────────────────────────────

  async putPhotoBlob(photo: StoredPhoto): Promise<void> {
    await this.db.put(STORE_PHOTOS, photo);
  }

  async getPhotoBlob(id: string): Promise<StoredPhoto | null> {
    return (await this.db.get(STORE_PHOTOS, id)) ?? null;
  }

  async deletePhotoBlob(id: string): Promise<void> {
    await this.db.delete(STORE_PHOTOS, id);
  }

  async getPhotoBlobsForPerson(personId: string): Promise<StoredPhoto[]> {
    return this.db.getAllFromIndex(STORE_PHOTOS, 'by-person', personId);
  }

  /**
   * Build a fully hydrated tree (photos carry blobs) for the serializer/export.
   * Photo blobs are read from the photo store and matched to tree.photos.
   */
  async hydrateForExport(tree: FamilyTree): Promise<FamilyTree> {
    const photos = await Promise.all(
      tree.photos.map(async (meta) => {
        const stored = await this.getPhotoBlob(meta.id);
        return {
          id: meta.id,
          personId: meta.personId,
          mime: meta.mime,
          blob: stored?.blob,
        };
      }),
    );
    return { ...tree, photos };
  }

  /**
   * Persist an imported/restored tree: write each photo's blob to the photo
   * store, strip blobs from the tree document, then save the tree.
   */
  async persistImportedTree(tree: FamilyTree): Promise<FamilyTree> {
    for (const p of tree.photos) {
      if (p.blob) {
        await this.putPhotoBlob({
          id: p.id,
          personId: p.personId,
          mime: p.mime,
          blob: p.blob,
        });
      }
    }
    const dehydrated: FamilyTree = {
      ...tree,
      photos: tree.photos.map((p) => ({ id: p.id, personId: p.personId, mime: p.mime })),
    };
    await this.saveTree(dehydrated);
    return dehydrated;
  }

  // ── Bin cleanup ────────────────────────────────────────────────────────────

  /**
   * Purge soft-deleted persons past the retention window and, for each purged
   * person, delete their photo blobs. Returns the updated tree (or the same
   * object when nothing expired). Caller decides whether to also sync.
   */
  async cleanupBin(
    tree: FamilyTree,
    now: Date,
    retentionDays: number = BIN_RETENTION_DAYS,
  ): Promise<FamilyTree> {
    const cleaned = purgeExpiredBin(tree, retentionDays, now);
    if (cleaned === tree) return tree;

    // Delete blobs for photos that no longer have a record.
    const survivingPhotoIds = new Set(cleaned.photos.map((p) => p.id));
    for (const p of tree.photos) {
      if (!survivingPhotoIds.has(p.id)) await this.deletePhotoBlob(p.id);
    }

    await this.saveTree(cleaned);
    return cleaned;
  }

  // ── Meta key/value (used by the sync layer) ────────────────────────────────

  async getMeta<T>(key: string): Promise<T | null> {
    return ((await this.db.get(STORE_META, key)) as T) ?? null;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.put(STORE_META, value, key);
  }

  /** Test/utility helper: wipe every store. */
  async clearAll(): Promise<void> {
    await Promise.all([
      this.db.clear(STORE_TREE),
      this.db.clear(STORE_SNAPSHOTS),
      this.db.clear(STORE_PHOTOS),
      this.db.clear(STORE_META),
    ]);
  }
}
