import { v4 as uuidv4 } from 'uuid';

/**
 * Centralized ID generation so tests can stub it and so the rest of the code
 * never imports uuid directly.
 */
export function newId(): string {
  return uuidv4();
}

/** Stable device identity, persisted in localStorage (spec §3 deviceId). */
const DEVICE_ID_KEY = 'familytree.deviceId';

export function getDeviceId(): string {
  // Guard for non-browser (test/SSR) contexts.
  if (typeof localStorage === 'undefined') return 'test-device';
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = newId();
  localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}
