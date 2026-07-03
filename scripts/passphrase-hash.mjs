#!/usr/bin/env node
/**
 * Compute the SHA-256 hash of a passphrase for the Worker's PASSPHRASE_HASH
 * secret. The plain passphrase is never stored anywhere — only this hash.
 *
 * Usage:
 *   node scripts/passphrase-hash.mjs "the family password"
 * or pipe it in:
 *   printf '%s' "the family password" | node scripts/passphrase-hash.mjs
 */

import { createHash } from 'node:crypto';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const argPass = process.argv.slice(2).join(' ');
const passphrase = argPass || (await readStdin());
const trimmed = passphrase.replace(/\n$/, '');

if (!trimmed) {
  console.error('No passphrase provided.');
  process.exit(1);
}

const hash = createHash('sha256').update(trimmed, 'utf8').digest('hex');
console.log(hash);
