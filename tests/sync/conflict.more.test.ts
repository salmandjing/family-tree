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
  savedAt: 's',
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

describe('decideSync full matrix', () => {
  const cases: Array<[string, ReturnType<typeof decideSync>['action'], LocalState, DriveState | null, SyncMeta | null]> = [
    ['empty local, no drive, no meta', 'in-sync', local(0, true), null, null],
    ['data local, no drive', 'backup', local(4), null, null],
    ['empty local, drive exists, no meta', 'restore', local(0, true), drive(9), null],
    ['data local, drive exists, no meta', 'conflict', local(4), drive(9), null],
    ['neither moved', 'in-sync', local(5), drive(8), meta(5, 8)],
    ['only local moved', 'backup', local(6), drive(8), meta(5, 8)],
    ['only drive moved', 'restore', local(5), drive(9), meta(5, 8)],
    ['both moved', 'conflict', local(6), drive(9), meta(5, 8)],
    ['empty local but meta present, drive moved', 'restore', local(5, true), drive(9), meta(5, 8)],
  ];

  for (const [name, expected, l, d, m] of cases) {
    it(name, () => {
      expect(decideSync(l, d, m).action).toBe(expected);
    });
  }

  it('every decision carries a human reason', () => {
    const r = decideSync(local(6), drive(9), meta(5, 8));
    expect(r.reason.length).toBeGreaterThan(0);
  });
});
