/**
 * Passphrase authentication for the Worker (spec §7). The passphrase itself is
 * never stored; the Worker holds only a SHA-256 hash in an environment secret.
 * Comparison is constant-time to avoid leaking the hash via timing.
 */

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Constant-time comparison of two equal-length hex strings. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Verify a provided passphrase against the stored hash. */
export async function verifyPassphrase(
  provided: string,
  storedHash: string,
): Promise<boolean> {
  if (!provided || !storedHash) return false;
  const providedHash = await sha256Hex(provided);
  return timingSafeEqualHex(providedHash, storedHash.toLowerCase());
}

/** Extract a bearer token from the Authorization header. */
export function extractBearer(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}
