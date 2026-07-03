import { describe, it, expect } from 'vitest';
import {
  sha256Hex,
  timingSafeEqualHex,
  verifyPassphrase,
  extractBearer,
} from '../../worker/src/auth';

describe('sha256Hex', () => {
  it('produces the known SHA-256 of a string', async () => {
    // Known vector: SHA-256("abc")
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('timingSafeEqualHex', () => {
  it('is true for equal strings and false otherwise', () => {
    expect(timingSafeEqualHex('abcd', 'abcd')).toBe(true);
    expect(timingSafeEqualHex('abcd', 'abce')).toBe(false);
    expect(timingSafeEqualHex('abcd', 'abc')).toBe(false);
  });
});

describe('verifyPassphrase', () => {
  it('accepts the correct passphrase against its hash', async () => {
    const hash = await sha256Hex('open sesame');
    expect(await verifyPassphrase('open sesame', hash)).toBe(true);
  });
  it('rejects the wrong passphrase', async () => {
    const hash = await sha256Hex('open sesame');
    expect(await verifyPassphrase('wrong', hash)).toBe(false);
  });
  it('is case-insensitive on the stored hex hash', async () => {
    const hash = (await sha256Hex('x')).toUpperCase();
    expect(await verifyPassphrase('x', hash)).toBe(true);
  });
  it('rejects empty inputs', async () => {
    expect(await verifyPassphrase('', 'abc')).toBe(false);
    expect(await verifyPassphrase('x', '')).toBe(false);
  });
});

describe('extractBearer', () => {
  it('reads a bearer token', () => {
    const req = new Request('https://x', {
      headers: { Authorization: 'Bearer secret123' },
    });
    expect(extractBearer(req)).toBe('secret123');
  });
  it('returns null without a bearer', () => {
    expect(extractBearer(new Request('https://x'))).toBeNull();
  });
});
