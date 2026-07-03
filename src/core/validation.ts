/**
 * Structural validation for a FamilyTree. Runs at trust boundaries — chiefly
 * when importing a JSON file or restoring a Drive backup (never trust external
 * data, spec §7 / security rules). Distinguishes hard errors (reject) from
 * warnings (repairable, surfaced but non-fatal).
 */

import { SCHEMA_VERSION, type FamilyTree } from './types';

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validate an unknown value as a FamilyTree. Returns collected errors/warnings.
 * `ok` is true only when there are no errors.
 */
export function validateTree(input: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const err = (message: string) => errors.push({ level: 'error', message });
  const warn = (message: string) => warnings.push({ level: 'warning', message });

  if (!isObject(input)) {
    return { ok: false, errors: [{ level: 'error', message: 'Not an object' }], warnings };
  }

  const t = input as Partial<FamilyTree>;

  if (t.schemaVersion !== SCHEMA_VERSION) {
    err(`Unsupported schemaVersion: ${String(t.schemaVersion)} (expected ${SCHEMA_VERSION})`);
  }
  if (typeof t.revision !== 'number' || !Number.isFinite(t.revision) || t.revision < 0) {
    err(`Invalid revision: ${String(t.revision)}`);
  }
  if (typeof t.deviceId !== 'string' || t.deviceId.length === 0) {
    warn('Missing deviceId');
  }
  if (!Array.isArray(t.persons)) {
    err('persons is not an array');
  }
  if (!Array.isArray(t.unions)) {
    err('unions is not an array');
  }
  if (t.photos !== undefined && !Array.isArray(t.photos)) {
    err('photos is not an array');
  }

  // Bail early if the core arrays are unusable — deeper checks would throw.
  if (errors.length > 0) return { ok: false, errors, warnings };

  const persons = t.persons!;
  const unions = t.unions!;
  const photos = t.photos ?? [];

  // Person ids: present and unique.
  const personIds = new Set<string>();
  for (const [i, p] of persons.entries()) {
    if (!isObject(p) || typeof p.id !== 'string' || p.id.length === 0) {
      err(`persons[${i}] has no valid id`);
      continue;
    }
    if (personIds.has(p.id)) err(`Duplicate person id: ${p.id}`);
    personIds.add(p.id);
    if (!isObject((p as Record<string, unknown>).name)) {
      warn(`persons[${i}] (${p.id}) missing name object`);
    }
  }

  // Union ids unique; referenced persons must exist.
  const unionIds = new Set<string>();
  for (const [i, u] of unions.entries()) {
    if (!isObject(u) || typeof u.id !== 'string' || u.id.length === 0) {
      err(`unions[${i}] has no valid id`);
      continue;
    }
    if (unionIds.has(u.id)) err(`Duplicate union id: ${u.id}`);
    unionIds.add(u.id);

    const partners = (u as Record<string, unknown>).partners;
    if (!Array.isArray(partners)) {
      err(`unions[${i}] (${u.id}) partners is not an array`);
    } else {
      for (const pid of partners) {
        if (typeof pid !== 'string' || !personIds.has(pid)) {
          err(`union ${u.id} references unknown partner ${String(pid)}`);
        }
      }
    }

    const children = (u as Record<string, unknown>).children;
    if (!Array.isArray(children)) {
      err(`unions[${i}] (${u.id}) children is not an array`);
    } else {
      for (const c of children) {
        const cid = isObject(c) ? c.personId : undefined;
        if (typeof cid !== 'string' || !personIds.has(cid)) {
          err(`union ${u.id} references unknown child ${String(cid)}`);
        }
      }
    }
  }

  // Photo references: person must exist; warn on orphans (recoverable).
  for (const [i, ph] of photos.entries()) {
    if (!isObject(ph) || typeof ph.id !== 'string') {
      err(`photos[${i}] has no valid id`);
      continue;
    }
    if (typeof ph.personId === 'string' && !personIds.has(ph.personId)) {
      warn(`photo ${ph.id} references unknown person ${ph.personId}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Throwing variant for call sites that treat invalid input as fatal. */
export function assertValidTree(input: unknown): asserts input is FamilyTree {
  const result = validateTree(input);
  if (!result.ok) {
    const summary = result.errors.map((e) => e.message).join('; ');
    throw new Error(`Invalid family tree: ${summary}`);
  }
}
