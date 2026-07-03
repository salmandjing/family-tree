import { describe, it, expect, beforeEach } from 'vitest';
import { newId, getDeviceId } from '@/core/ids';

describe('newId', () => {
  it('generates unique v4-shaped ids', () => {
    const a = newId();
    const b = newId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('getDeviceId', () => {
  beforeEach(() => {
    localStorage.removeItem('familytree.deviceId');
  });

  it('creates and persists a device id', () => {
    const first = getDeviceId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    // Stable across calls.
    expect(getDeviceId()).toBe(first);
  });

  it('reuses an existing stored id', () => {
    localStorage.setItem('familytree.deviceId', 'preset-device');
    expect(getDeviceId()).toBe('preset-device');
  });
});
