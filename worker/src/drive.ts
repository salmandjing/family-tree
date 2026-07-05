/**
 * Minimal Google Drive client for the backup Worker (spec §7: `drive.file`
 * scope only). Uses a stored OAuth refresh token to mint short-lived access
 * tokens. `fetch` is injectable so the client can be tested against a mocked
 * Drive (spec §11 integration).
 *
 * File layout in Drive:
 *  - `family-tree-latest.json`         — always the newest tree (the pointer)
 *  - `family-tree-<timestamp>.json`    — immutable historical copies
 *
 * Tree metadata (revision/deviceId/savedAt) is mirrored into Drive
 * `appProperties` so `GET /latest` can read it without downloading the file.
 */

export interface DriveConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface DriveFileMeta {
  id: string;
  name: string;
  createdTime: string;
  appProperties?: Record<string, string>;
}

export interface TreeMeta {
  revision: number;
  deviceId: string;
  savedAt: string;
}

export const LATEST_NAME = 'family-tree-latest.json';
export const FOLDER_NAME = 'Family Tree Backups';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

type FetchLike = typeof fetch;

// On the Workers runtime the global `fetch` must be called unbound; invoking it
// through a stored reference (this.fetchImpl) triggers an "Illegal invocation"
// error. Wrap it so the default always calls the global directly.
const globalFetch: FetchLike = (input, init) => fetch(input, init);

export class DriveClient {
  private accessToken: string | null = null;
  private folderId: string | null = null;

  constructor(
    private readonly config: DriveConfig,
    private readonly fetchImpl: FetchLike = globalFetch,
  ) {}

  private async token(): Promise<string> {
    if (this.accessToken) return this.accessToken;
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: this.config.refreshToken,
      grant_type: 'refresh_token',
    });
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      throw new Error(`Drive auth failed (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as { access_token: string };
    this.accessToken = json.access_token;
    return this.accessToken;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.token()}` };
  }

  /** List all app-created backup files (newest first). */
  async listBackups(): Promise<DriveFileMeta[]> {
    const params = new URLSearchParams({
      spaces: 'drive',
      q: "name contains 'family-tree' and trashed = false",
      fields: 'files(id,name,createdTime,appProperties)',
      orderBy: 'createdTime desc',
      pageSize: '1000',
    });
    const res = await this.fetchImpl(`${API}/files?${params}`, {
      headers: await this.authHeaders(),
    });
    if (!res.ok) throw new Error(`Drive list failed (${res.status})`);
    const json = (await res.json()) as { files?: DriveFileMeta[] };
    return json.files ?? [];
  }

  /** Find the `latest` pointer file, if it exists. */
  async findLatest(): Promise<DriveFileMeta | null> {
    const files = await this.listBackups();
    return files.find((f) => f.name === LATEST_NAME) ?? null;
  }

  /** Read the tree metadata of the latest backup without downloading it. */
  async latestMeta(): Promise<TreeMeta | null> {
    const latest = await this.findLatest();
    if (!latest?.appProperties) return null;
    const p = latest.appProperties;
    if (p.revision == null) return null;
    return {
      revision: Number(p.revision),
      deviceId: p.deviceId ?? '',
      savedAt: p.savedAt ?? latest.createdTime,
    };
  }

  /** Download the full JSON content of the latest backup. */
  async downloadLatest(): Promise<string | null> {
    const latest = await this.findLatest();
    if (!latest) return null;
    const res = await this.fetchImpl(`${API}/files/${latest.id}?alt=media`, {
      headers: await this.authHeaders(),
    });
    if (!res.ok) throw new Error(`Drive download failed (${res.status})`);
    return res.text();
  }

  private multipartBody(
    metadata: Record<string, unknown>,
    content: string,
    boundary: string,
  ): string {
    return (
      `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      'Content-Type: application/json\r\n\r\n' +
      `${content}\r\n` +
      `--${boundary}--`
    );
  }

  /**
   * Find (or create) the "Family Tree Backups" folder and return its id, so all
   * backups live in one place instead of the Drive root. Cached per request.
   */
  async ensureFolder(): Promise<string> {
    if (this.folderId) return this.folderId;
    const params = new URLSearchParams({
      q: `name = '${FOLDER_NAME}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'files(id)',
      pageSize: '1',
    });
    const res = await this.fetchImpl(`${API}/files?${params}`, {
      headers: await this.authHeaders(),
    });
    if (res.ok) {
      const json = (await res.json()) as { files?: { id: string }[] };
      if (json.files?.[0]) {
        this.folderId = json.files[0].id;
        return this.folderId;
      }
    }
    // Not found → create it.
    const create = await this.fetchImpl(`${API}/files`, {
      method: 'POST',
      headers: { ...(await this.authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
    });
    if (!create.ok) {
      throw new Error(`Drive folder create failed (${create.status})`);
    }
    const created = (await create.json()) as { id: string };
    this.folderId = created.id;
    return this.folderId;
  }

  private async upload(
    fileId: string | null,
    name: string,
    content: string,
    meta: TreeMeta,
    parents?: string[],
  ): Promise<DriveFileMeta> {
    const boundary = `boundary_${meta.revision}_${name.length}`;
    const metadata: Record<string, unknown> = {
      name,
      appProperties: {
        revision: String(meta.revision),
        deviceId: meta.deviceId,
        savedAt: meta.savedAt,
      },
    };
    // parents are only settable on create; a PATCH keeps the file where it is.
    if (!fileId && parents && parents.length > 0) metadata.parents = parents;
    const url = fileId
      ? `${UPLOAD}/files/${fileId}?uploadType=multipart`
      : `${UPLOAD}/files?uploadType=multipart`;
    const res = await this.fetchImpl(url, {
      method: fileId ? 'PATCH' : 'POST',
      headers: {
        ...(await this.authHeaders()),
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: this.multipartBody(metadata, content, boundary),
    });
    if (!res.ok) {
      throw new Error(`Drive upload failed (${res.status}): ${await res.text()}`);
    }
    return (await res.json()) as DriveFileMeta;
  }

  /** Create or update `family-tree-latest.json` (inside the backups folder). */
  async putLatest(content: string, meta: TreeMeta): Promise<DriveFileMeta> {
    const existing = await this.findLatest();
    // Only new files need a parent folder; updates stay where they already are.
    const parents = existing ? undefined : [await this.ensureFolder()];
    return this.upload(existing?.id ?? null, LATEST_NAME, content, meta, parents);
  }

  /** Create an immutable timestamped copy in the backups folder. */
  async putTimestamped(
    content: string,
    meta: TreeMeta,
    timestamp: string,
  ): Promise<DriveFileMeta> {
    const safe = timestamp.replace(/[:]/g, '-').replace(/\..+$/, '');
    const parents = [await this.ensureFolder()];
    return this.upload(null, `family-tree-${safe}.json`, content, meta, parents);
  }

  async deleteFile(id: string): Promise<void> {
    const res = await this.fetchImpl(`${API}/files/${id}`, {
      method: 'DELETE',
      headers: await this.authHeaders(),
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Drive delete failed (${res.status})`);
    }
  }

  /** Timestamped copies only (excludes the latest pointer). */
  async listTimestamped(): Promise<DriveFileMeta[]> {
    const files = await this.listBackups();
    return files.filter((f) => f.name !== LATEST_NAME);
  }
}
