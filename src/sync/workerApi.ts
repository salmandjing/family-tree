/**
 * Typed client for the backup Worker. Network boundary for the SyncClient;
 * `fetch` is injectable for testing. All requests carry the passphrase as a
 * bearer token (spec §7).
 */

import type { TreeMeta } from './types';

export interface LatestResponse {
  meta: TreeMeta | null;
  content?: string;
}

export interface HealthResponse {
  ok: boolean;
  lastBackupAt: string | null;
  lastBackupRevision: number | null;
}

export interface WorkerApi {
  health(): Promise<HealthResponse>;
  latestMeta(): Promise<TreeMeta | null>;
  latestWithContent(): Promise<LatestResponse>;
  backup(content: string, meta: TreeMeta): Promise<{ revision: number }>;
}

export class HttpWorkerApi implements WorkerApi {
  constructor(
    private readonly baseUrl: string,
    private readonly passphrase: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.passphrase}` };
  }

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}${path}`;
  }

  async health(): Promise<HealthResponse> {
    const res = await this.fetchImpl(this.url('/health'));
    if (!res.ok) throw new Error(`Health check failed (${res.status})`);
    return (await res.json()) as HealthResponse;
  }

  async latestMeta(): Promise<TreeMeta | null> {
    const res = await this.fetchImpl(this.url('/latest'), {
      headers: this.authHeaders(),
    });
    if (res.status === 401) throw new Error('Wrong passphrase');
    if (!res.ok) throw new Error(`Could not read backup (${res.status})`);
    const body = (await res.json()) as LatestResponse;
    return body.meta;
  }

  async latestWithContent(): Promise<LatestResponse> {
    const res = await this.fetchImpl(this.url('/latest?content=1'), {
      headers: this.authHeaders(),
    });
    if (res.status === 401) throw new Error('Wrong passphrase');
    if (!res.ok) throw new Error(`Could not read backup (${res.status})`);
    return (await res.json()) as LatestResponse;
  }

  async backup(content: string, meta: TreeMeta): Promise<{ revision: number }> {
    const res = await this.fetchImpl(this.url('/backup'), {
      method: 'PUT',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, meta }),
    });
    if (res.status === 401) throw new Error('Wrong passphrase');
    if (res.status === 429) throw new Error('Too many attempts; please wait');
    if (!res.ok) throw new Error(`Backup failed (${res.status})`);
    return (await res.json()) as { revision: number };
  }
}
