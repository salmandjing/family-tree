/** Small display helpers for person names and dates. */

import type { Person } from '../core/types';

export function displayName(person: Person | undefined): string {
  if (!person) return 'Unknown';
  const full = [person.name.given, person.name.family].filter(Boolean).join(' ').trim();
  if (full) return full;
  if (person.name.nicknames[0]) return person.name.nicknames[0];
  return 'Unnamed person';
}

export function lifeSpan(person: Person): string {
  const b = person.birth.date ? (person.birth.approx ? `~${person.birth.date}` : person.birth.date) : '';
  const d = person.death.date ? (person.death.approx ? `~${person.death.date}` : person.death.date) : '';
  if (!b && !d) return '';
  if (b && !d) return person.living ? `b. ${b}` : `${b} –`;
  if (!b && d) return `d. ${d}`;
  return `${b} – ${d}`;
}
