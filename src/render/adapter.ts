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
        'first name': person.name.given,
        'last name': person.name.family,
        birthday: birthdayLabel(person),
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
