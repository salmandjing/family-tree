/** Always-visible search: typing a name lists matches; picking one centers the tree. */

import { useMemo, useState } from 'react';
import { useTree } from '../app/TreeContext';
import { activePersons } from '../core/operations';
import { displayName, lifeSpan } from './format';
import { t } from '../i18n';

interface SearchBoxProps {
  onPick: (id: string) => void;
}

export function SearchBox({ onPick }: SearchBoxProps) {
  const tree = useTree();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return activePersons(tree)
      .filter((p) => {
        const hay = [
          p.name.given,
          p.name.family,
          ...p.name.nicknames,
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 12);
  }, [tree, query]);

  return (
    <div className="search-box">
      <input
        type="search"
        placeholder={t.search.placeholder}
        value={query}
        aria-label={t.search.aria}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && matches.length > 0 && (
        <ul className="search-results" role="listbox">
          {matches.map((p) => (
            <li key={p.id}>
              <button
                role="option"
                aria-selected={false}
                onClick={() => {
                  onPick(p.id);
                  setQuery('');
                  setOpen(false);
                }}
              >
                <span className="name">{displayName(p)}</span>
                {lifeSpan(p) && <span className="dates">{lifeSpan(p)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
