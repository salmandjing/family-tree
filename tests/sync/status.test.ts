import { describe, it, expect } from 'vitest';
import { initialStatus, statusLine, timeAgo } from '@/sync/status';

const now = new Date('2026-07-02T14:00:00Z');

describe('timeAgo', () => {
  it('handles never', () => {
    expect(timeAgo(null, now)).toBe('jamais');
  });
  it('formats minutes, hours, days', () => {
    expect(timeAgo('2026-07-02T13:58:00Z', now)).toBe('il y a 2 min');
    expect(timeAgo('2026-07-02T11:00:00Z', now)).toBe('il y a 3 h');
    expect(timeAgo('2026-06-30T14:00:00Z', now)).toBe('il y a 2 jours');
    expect(timeAgo('2026-07-02T13:59:40Z', now)).toBe('à l’instant');
  });
});

describe('statusLine', () => {
  it('gives plain-language text for each state', () => {
    const base = initialStatus();
    expect(statusLine({ ...base, state: 'local-only' })).toMatch(/cet appareil/);
    expect(
      statusLine({ ...base, state: 'idle', lastBackupAt: '2026-07-02T13:58:00Z' }, now),
    ).toMatch(/Sauvegardé il y a 2 min/);
    expect(statusLine({ ...base, state: 'pending' })).toMatch(/sauvegarde en ligne/i);
    expect(statusLine({ ...base, state: 'backing-up' })).toMatch(/Sauvegarde en cours/);
    expect(statusLine({ ...base, state: 'offline' })).toMatch(/Hors ligne/);
    expect(statusLine({ ...base, state: 'error' })).toMatch(/ne fonctionne plus/);
  });
});

describe('initialStatus', () => {
  it('starts local-only with no backup', () => {
    const s = initialStatus();
    expect(s.state).toBe('local-only');
    expect(s.lastBackupAt).toBeNull();
  });
});
