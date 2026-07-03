import { describe, it, expect } from 'vitest';
import {
  decideSync,
  type DriveState,
  type LocalState,
  type SyncMeta,
} from '@/sync/conflict';

const drive = (revision: number): DriveState => ({
  revision,
  deviceId: 'other',
  savedAt: '2026-07-02T14:00:00Z',
});
const local = (revision: number, isEmpty = false): LocalState => ({
  revision,
  deviceId: 'me',
  isEmpty,
});
const meta = (l: number, d: number): SyncMeta => ({
  syncedLocalRevision: l,
  syncedDriveRevision: d,
});

describe('decideSync — no Drive backup', () => {
  it('is in-sync when local is empty and Drive is empty', () => {
    expect(decideSync(local(0, true), null, null).action).toBe('in-sync');
  });
  it('backs up when local has data and Drive is empty', () => {
    expect(decideSync(local(5), null, null).action).toBe('backup');
  });
});

describe('decideSync — new device (no sync meta)', () => {
  it('restores when local is empty and Drive has a backup', () => {
    expect(decideSync(local(0, true), drive(10), null).action).toBe('restore');
  });
  it('conflicts when local has independent data and Drive has a backup', () => {
    expect(decideSync(local(3), drive(10), null).action).toBe('conflict');
  });
});

describe('decideSync — with a common base', () => {
  it('is in-sync when neither side moved', () => {
    expect(decideSync(local(10), drive(20), meta(10, 20)).action).toBe('in-sync');
  });
  it('backs up when only local moved', () => {
    expect(decideSync(local(12), drive(20), meta(10, 20)).action).toBe('backup');
  });
  it('restores when only Drive moved', () => {
    expect(decideSync(local(10), drive(21), meta(10, 20)).action).toBe('restore');
  });
  it('conflicts when both moved', () => {
    const d = decideSync(local(12), drive(21), meta(10, 20));
    expect(d.action).toBe('conflict');
    expect(d.reason).toMatch(/[Bb]oth/);
  });
});
