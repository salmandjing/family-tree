/**
 * Renderer adapter: converts the core FamilyTree graph into the input format
 * consumed by `family-chart` (spec §2 "Renderer adapter", §10). Keeping this in
 * one small, pure module means the renderer is swappable without touching data
 * (spec §2: "the renderer is swappable without touching data").
 *
 * family-chart's Datum shape (v0.9):
 *   { id, data: { gender, ...display }, rels: { parents, spouses, children } }
 */

import { activePersons } from '../core/operations';
import { childIds, parentIds, spouseIds } from '../core/relationships';
import type { FamilyTree, Person } from '../core/types';

/** Mirror of family-chart's Datum, kept local so the adapter owns the contract. */
export interface RenderDatum {
  id: string;
  data: {
    /** family-chart only understands M/F; 'unknown' is mapped to a default. */
    gender: 'M' | 'F';
    'first name': string;
    'last name': string;
    birthday: string;
    avatar: string;
    /** Our real sex, preserved for the UI even when gender was defaulted. */
    _sex: Person['sex'];
    _living: boolean;
    _hasPhoto: boolean;
  };
  rels: {
    parents: string[];
    spouses: string[];
    children: string[];
  };
}

/**
 * Escape HTML-significant characters. family-chart renders the display fields
 * into `innerHTML` WITHOUT escaping, so a person name/date containing markup
 * would otherwise execute as DOM (stored XSS — e.g. from an imported JSON that
 * could steal the passphrase from localStorage). We escape at this sink so the
 * renderer only ever receives inert text.
 */
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** family-chart requires M|F; map 'unknown' to a neutral default ('M'). */
function toGender(sex: Person['sex']): 'M' | 'F' {
  return sex === 'F' ? 'F' : 'M';
}

/** A short human label for a birth year, honoring the approx flag. */
function birthdayLabel(person: Person): string {
  const d = person.birth.date;
  if (!d) return '';
  return person.birth.approx ? `~${d}` : d;
}

/**
 * Build the render dataset from the tree. Only active (non-soft-deleted)
 * persons are rendered; links to deleted persons are dropped so the chart never
 * points at a missing node.
 */
export function toRenderData(
  tree: FamilyTree,
  avatarUrls: Map<string, string> = new Map(),
): RenderDatum[] {
  const activeIds = new Set(activePersons(tree).map((p) => p.id));
  const keep = (id: string) => activeIds.has(id);

  return activePersons(tree).map((person) => {
    const primaryPhoto = person.photos[0];
    return {
      id: person.id,
      data: {
        gender: toGender(person.sex),
        // Escaped: family-chart injects these into innerHTML unescaped.
        'first name': htmlEscape(person.name.given),
        'last name': htmlEscape(person.name.family),
        birthday: htmlEscape(birthdayLabel(person)),
        avatar: (primaryPhoto && avatarUrls.get(primaryPhoto)) || '',
        _sex: person.sex,
        _living: person.living,
        _hasPhoto: person.photos.length > 0,
      },
      rels: {
        parents: parentIds(tree, person.id).filter(keep),
        spouses: spouseIds(tree, person.id).filter(keep),
        children: childIds(tree, person.id).filter(keep),
      },
    };
  });
}

/**
 * family-chart needs a non-empty dataset with at least one node to render; the
 * caller can use this to decide whether to show an empty state instead.
 */
export function hasRenderableData(tree: FamilyTree): boolean {
  return activePersons(tree).length > 0;
}

/** Number of descendants of a person (cycle-guarded). */
function descendantCount(
  tree: FamilyTree,
  id: string,
  seen: Set<string> = new Set(),
): number {
  if (seen.has(id)) return 0;
  seen.add(id);
  let n = 0;
  for (const c of childIds(tree, id)) n += 1 + descendantCount(tree, c, seen);
  return n;
}

/**
 * Best "main" person for a whole-tree view: a top ancestor (no parents) whose
 * subtree covers the most people, so family-chart renders every branch. Falls
 * back to the person with the most descendants if there is no clear root.
 */
export function pickRoot(tree: FamilyTree): string | undefined {
  const active = activePersons(tree);
  if (active.length === 0) return undefined;
  const roots = active.filter((p) => parentIds(tree, p.id).length === 0);
  const candidates = roots.length > 0 ? roots : active;
  let best = candidates[0];
  let bestCount = -1;
  for (const p of candidates) {
    const count = descendantCount(tree, p.id);
    if (count > bestCount) {
      bestCount = count;
      best = p;
    }
  }
  return best.id;
}
