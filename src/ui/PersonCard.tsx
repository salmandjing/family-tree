/**
 * PersonCard — the slide-in editor for one person (spec §9). Big touch targets,
 * name-only required, everything else optional. Houses the "Add parent / spouse
 * / child / photo", edit fields, notes, relatives navigation, and delete-to-bin.
 */

import { useMemo, useRef, useState } from 'react';
import { useTree, useTreeService } from '../app/TreeContext';
import { getPerson, patchPerson } from '../core/operations';
import {
  addChild,
  addParent,
  addSpouse,
  childIds,
  parentIds,
  spouseIds,
  unionsAsPartner,
} from '../core/relationships';
import type { Person, Sex } from '../core/types';
import { displayName, lifeSpan } from './format';
import { PhotoThumb } from './PhotoThumb';

interface PersonCardProps {
  personId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: 'M', label: 'Male' },
  { value: 'F', label: 'Female' },
  { value: 'unknown', label: 'Unknown' },
];

export function PersonCard({ personId, onSelect, onClose }: PersonCardProps) {
  const tree = useTree();
  const service = useTreeService();
  const person = getPerson(tree, personId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [childPickerOpen, setChildPickerOpen] = useState(false);

  const relatives = useMemo(() => {
    if (!person) return { parents: [], spouses: [], children: [] };
    return {
      parents: parentIds(tree, personId),
      spouses: spouseIds(tree, personId),
      children: childIds(tree, personId),
    };
  }, [tree, personId, person]);

  if (!person) {
    return (
      <aside className="person-card" role="dialog" aria-label="Person details">
        <p>This person no longer exists.</p>
        <button onClick={onClose}>Close</button>
      </aside>
    );
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const update = (fields: Partial<Omit<Person, 'id'>>) =>
    run(() => service.apply((t, clock) => patchPerson(t, personId, fields, clock)));

  const handleAddParent = () =>
    run(async () => {
      const r = await addParentViaService();
      onSelect(r);
    });

  async function addParentViaService(): Promise<string> {
    let newId = '';
    await service.apply((t, clock) => {
      const res = addParent(t, personId, { given: '' }, clock);
      newId = res.person.id;
      return res.tree;
    });
    return newId;
  }

  const handleAddSpouse = () =>
    run(async () => {
      let newId = '';
      await service.apply((t, clock) => {
        const res = addSpouse(t, personId, { given: '' }, 'married', clock);
        newId = res.person.id;
        return res.tree;
      });
      onSelect(newId);
    });

  const handleAddChild = (unionId?: string) =>
    run(async () => {
      let newId = '';
      await service.apply((t, clock) => {
        const res = addChild(t, personId, { given: '' }, { unionId }, clock);
        newId = res.person.id;
        return res.tree;
      });
      setChildPickerOpen(false);
      onSelect(newId);
    });

  function onAddChildClick() {
    const unions = unionsAsPartner(tree, personId);
    if (unions.length > 1) {
      setChildPickerOpen(true); // ask which co-parent (polygamy case)
    } else {
      handleAddChild(unions[0]?.id);
    }
  }

  const handlePhoto = (file: File | undefined) => {
    if (!file) return;
    run(() => service.addPhoto(personId, file).then(() => undefined));
  };

  const handleDelete = () =>
    run(async () => {
      await service.deletePerson(personId);
      onClose();
    });

  return (
    <aside className="person-card" role="dialog" aria-label={`Details for ${displayName(person)}`}>
      <div className="person-card-header">
        <PhotoThumb photoId={person.photos[0]} alt={displayName(person)} className="large" />
        <div className="person-card-title">
          <h2>{displayName(person)}</h2>
          {lifeSpan(person) && <p className="lifespan">{lifeSpan(person)}</p>}
        </div>
        <button className="icon-btn close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}

      <div className="big-buttons">
        <button className="big-btn" disabled={busy} onClick={handleAddParent}>
          + Parent
        </button>
        <button className="big-btn" disabled={busy} onClick={handleAddSpouse}>
          + Spouse
        </button>
        <button className="big-btn" disabled={busy} onClick={onAddChildClick}>
          + Child
        </button>
        <button
          className="big-btn"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          + Photo
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => handlePhoto(e.target.files?.[0])}
        />
      </div>

      {childPickerOpen && (
        <div className="child-picker">
          <p>Add a child with which partner?</p>
          {unionsAsPartner(tree, personId).map((u) => {
            const other = u.partners.find((p) => p !== personId);
            const otherPerson = other ? getPerson(tree, other) : undefined;
            return (
              <button key={u.id} disabled={busy} onClick={() => handleAddChild(u.id)}>
                {otherPerson ? displayName(otherPerson) : 'Unknown partner'}
              </button>
            );
          })}
          <button className="secondary" onClick={() => setChildPickerOpen(false)}>
            Cancel
          </button>
        </div>
      )}

      <form className="person-form" onSubmit={(e) => e.preventDefault()}>
        <label>
          Given name
          <input
            value={person.name.given}
            onChange={(e) =>
              update({ name: { ...person.name, given: e.target.value } })
            }
          />
        </label>
        <label>
          Family name
          <input
            value={person.name.family}
            onChange={(e) =>
              update({ name: { ...person.name, family: e.target.value } })
            }
          />
        </label>
        <label>
          Nicknames (comma-separated)
          <input
            value={person.name.nicknames.join(', ')}
            onChange={(e) =>
              update({
                name: {
                  ...person.name,
                  nicknames: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                },
              })
            }
          />
        </label>
        <label>
          Sex
          <select
            value={person.sex}
            onChange={(e) => update({ sex: e.target.value as Sex })}
          >
            {SEX_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend>Born</legend>
          <input
            placeholder="e.g. 1950 or around 1950"
            value={person.birth.date ?? ''}
            onChange={(e) =>
              update({ birth: { ...person.birth, date: e.target.value || null } })
            }
          />
          <label className="inline">
            <input
              type="checkbox"
              checked={person.birth.approx}
              onChange={(e) =>
                update({ birth: { ...person.birth, approx: e.target.checked } })
              }
            />
            Approximate
          </label>
          <input
            placeholder="Place"
            value={person.birth.place}
            onChange={(e) =>
              update({ birth: { ...person.birth, place: e.target.value } })
            }
          />
        </fieldset>

        <fieldset>
          <legend>Died</legend>
          <label className="inline">
            <input
              type="checkbox"
              checked={!person.living}
              onChange={(e) =>
                update({
                  living: !e.target.checked,
                  death: e.target.checked
                    ? person.death
                    : { date: null, approx: false, place: '' },
                })
              }
            />
            Deceased
          </label>
          {!person.living && (
            <>
              <input
                placeholder="e.g. 2001 or around 2001"
                value={person.death.date ?? ''}
                onChange={(e) =>
                  update({ death: { ...person.death, date: e.target.value || null } })
                }
              />
              <label className="inline">
                <input
                  type="checkbox"
                  checked={person.death.approx}
                  onChange={(e) =>
                    update({ death: { ...person.death, approx: e.target.checked } })
                  }
                />
                Approximate
              </label>
              <input
                placeholder="Place"
                value={person.death.place}
                onChange={(e) =>
                  update({ death: { ...person.death, place: e.target.value } })
                }
              />
            </>
          )}
        </fieldset>

        <label className="notes">
          Stories & notes
          <textarea
            rows={5}
            placeholder="Anything worth remembering — stories, places, relationships…"
            value={person.notes}
            onChange={(e) => update({ notes: e.target.value })}
          />
        </label>
      </form>

      <RelativesSection title="Parents" ids={relatives.parents} tree={tree} onSelect={onSelect} />
      <RelativesSection title="Spouses" ids={relatives.spouses} tree={tree} onSelect={onSelect} />
      <RelativesSection title="Children" ids={relatives.children} tree={tree} onSelect={onSelect} />

      <button className="delete-btn" disabled={busy} onClick={handleDelete}>
        Move to Recently deleted
      </button>
    </aside>
  );
}

function RelativesSection({
  title,
  ids,
  tree,
  onSelect,
}: {
  title: string;
  ids: string[];
  tree: ReturnType<typeof useTree>;
  onSelect: (id: string) => void;
}) {
  if (ids.length === 0) return null;
  return (
    <div className="relatives">
      <h3>{title}</h3>
      <ul>
        {ids.map((id) => {
          const p = getPerson(tree, id);
          return (
            <li key={id}>
              <button className="link" onClick={() => onSelect(id)}>
                <PhotoThumb photoId={p?.photos[0]} alt={displayName(p)} className="tiny" />
                {displayName(p)}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
