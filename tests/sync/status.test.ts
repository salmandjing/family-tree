import { describe, it, expect } from 'vitest';
import { initialStatus, statusLine, timeAgo } from '@/sync/status';

const now = new Date('2026-07-02T14:00:00Z');

describe('timeAgo', () => {
  it('handles never', () => {
    expect(timeAgo(null, now)).toBe('never');
  });
  it('formats minutes, hours, days', () => {
    expect(timeAgo('2026-07-02T13:58:00Z', now)).toBe('2 min ago');
    expect(timeAgo('2026-07-02T11:00:00Z', now)).toBe('3 hr ago');
    expect(timeAgo('2026-06-30T14:00:00Z', now)).toBe('2 days ago');
    expect(timeAgo('2026-07-02T13:59:40Z', now)).toBe('just now');
  });
});

describe('statusLine', () => {
  it('gives plain-language text for each state', () => {
    const base = initialStatus();
    expect(statusLine({ ...base, state: 'local-only' })).toMatch(/this device/);
    expect(
      statusLine({ ...base, state: 'idle', lastBackupAt: '2026-07-02T13:58:00Z' }, now),
    ).toMatch(/Backed up 2 min ago/);
    expect(statusLine({ ...base, state: 'pending' })).toMatch(/backing up/i);
    expect(statusLine({ ...base, state: 'backing-up' })).toMatch(/Backing up/);
    expect(statusLine({ ...base, state: 'offline' })).toMatch(/Offline/);
    expect(statusLine({ ...base, state: 'error' })).toMatch(/stopped working/);
  });
});

describe('initialStatus', () => {
  it('starts local-only with no backup', () => {
    const s = initialStatus();
    expect(s.state).toBe('local-only');
    expect(s.lastBackupAt).toBeNull();
  });
});
