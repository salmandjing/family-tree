/**
 * App configuration and per-device passphrase storage (spec §7). The Worker URL
 * is a build-time env var; the passphrase is entered once per device and kept
 * in localStorage (it is also the bearer token sent to the Worker).
 */

const PASSPHRASE_KEY = 'familytree.passphrase';

/** The backup Worker base URL, or null when backup is not configured. */
export function workerUrl(): string | null {
  const url = import.meta.env.VITE_WORKER_URL as string | undefined;
  return url && url.length > 0 ? url : null;
}

export function backupEnabled(): boolean {
  return workerUrl() !== null;
}

export function getStoredPassphrase(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(PASSPHRASE_KEY);
}

export function setStoredPassphrase(passphrase: string): void {
  localStorage.setItem(PASSPHRASE_KEY, passphrase);
}

export function clearStoredPassphrase(): void {
  localStorage.removeItem(PASSPHRASE_KEY);
}
