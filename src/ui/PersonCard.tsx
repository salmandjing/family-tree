/**
 * PersonCard — the slide-in editor for one person (spec §9). Big touch targets,
 * name-only required, everything else optional. Houses the "Add parent / spouse
 * / child / photo", edit fields, notes, relatives navigation, and delete-to-bin.
 *
 * Text fields are backed by LOCAL draft state, not read straight from the
 * persisted tree. Typing updates the draft synchronously (never dropping a
 * keystroke) while persistence happens in the background; the draft re-seeds
 * only when a different person is opened.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { t } from '../i18n';

interface PersonCardProps {
  personId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: 'M', label: t.person.sexMale },
  { value: 'F', label: t.person.sexFemale },
  { value: 'unknown', label: t.person.sexUnknown },
];

interface Draft {
  given: string;
  family: string;
  nicknames: string;
  sex: Sex;
  birthDate: string;
  birthApprox: boolean;
  birthPlace: string;
  deceased: boolean;
  deathDate: string;
  deathApprox: boolean;
  deathPlace: string;
  notes: string;
}

function toDraft(p: Person): Draft {
  return {
    given: p.name.given,
    family: p.name.family,
    nicknames: p.name.nicknames.join(', '),
    sex: p.sex,
    birthDate: p.birth.date ?? '',
    birthApprox: p.birth.approx,
    birthPlace: p.birth.place,
    deceased: !p.living,
    deathDate: p.death.date ?? '',
    deathApprox: p.death.approx,
    deathPlace: p.death.place,
    notes: p.notes,
  };
}

/** Build the persisted fields entirely from the draft (no reliance on stale state). */
function draftToFields(d: Draft): Partial<Omit<Person, 'id'>> {
  return {
    name: {
      given: d.given,
      family: d.family,
      nicknames: d.nicknames.split(',').map((s) => s.trim()).filter(Boolean),
    },
    sex: d.sex,
    birth: { date: d.birthDate || null, approx: d.birthApprox, place: d.birthPlace },
    living: !d.deceased,
    death: d.deceased
      ? { date: d.deathDate || null, approx: d.deathApprox, place: d.deathPlace }
      : { date: null, approx: false, place: '' },
    notes: d.notes,
  };
}

export function PersonCard({ personId, onSelect, onClose }: PersonCardProps) {
  const tree = useTree();
  const service = useTreeService();
  const person = getPerson(tree, personId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [childPickerOpen, setChildPickerOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(person ? toDraft(person) : null);

  // Re-seed the draft only when a different person is opened, so background
  // persistence (which re-renders on every commit) never clobbers typing.
  useEffect(() => {
    const p = getPerson(service.getTree(), personId);
    setDraft(p ? toDraft(p) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId]);

  const relatives = useMemo(() => {
    if (!person) return { parents: [], spouses: [], children: [] };
    return {
      parents: parentIds(tree, personId),
      spouses: spouseIds(tree, personId),
      children: childIds(tree, personId),
    };
  }, [tree, personId, person]);

  if (!person || !draft) {
    return (
      <aside className="person-card" role="dialog" aria-label={t.person.gone}>
        <p>{t.person.gone}</p>
        <button onClick={onClose}>{t.person.close}</button>
      </aside>
    );
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message || t.person.somethingWrong);
    } finally {
      setBusy(false);
    }
  }

  /** Update the local draft immediately and persist in the background. */
  function edit(patch: Partial<Draft>) {
    setDraft((prev) => {
      const next = { ...(prev as Draft), ...patch };
      // Fire-and-forget persistence; typing stays snappy and lossless.
      void service
        .apply((t, clock) => patchPerson(t, personId, draftToFields(next), clock))
        .catch((e) => setError((e as Error).message));
      return next;
    });
  }

  const handleAddParent = () =>
    run(async () => {
      let newId = '';
      await service.apply((t, clock) => {
        const res = addParent(t, personId, { given: '' }, clock);
        newId = res.person.id;
        return res.tree;
      });
      onSelect(newId);
    });

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
    run(() => service.addPhoto(personId, file));
  };

  const handleDelete = () =>
    run(async () => {
      await service.deletePerson(personId);
      onClose();
    });

  return (
    <aside className="person-card" role="dialog" aria-label={t.person.detailsFor(displayName(person))}>
      <div className="person-card-header">
        <PhotoThumb photoId={person.photos[0]} alt={displayName(person)} className="large" />
        <div className="person-card-title">
          <h2>{displayName(person)}</h2>
          {lifeSpan(person) && <p className="lifespan">{lifeSpan(person)}</p>}
        </div>
        <button className="icon-btn close" onClick={onClose} aria-label={t.person.close}>
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
          {t.person.addParent}
        </button>
        <button className="big-btn" disabled={busy} onClick={handleAddSpouse}>
          {t.person.addSpouse}
        </button>
        <button className="big-btn" disabled={busy} onClick={onAddChildClick}>
          {t.person.addChild}
        </button>
        <button
          className="big-btn"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          {t.person.addPhoto}
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
          <p>{t.person.whichPartner}</p>
          {unionsAsPartner(tree, personId).map((u) => {
            const other = u.partners.find((p) => p !== personId);
            const otherPerson = other ? getPerson(tree, other) : undefined;
            return (
              <button key={u.id} disabled={busy} onClick={() => handleAddChild(u.id)}>
                {otherPerson ? displayName(otherPerson) : t.person.unknownPartner}
              </button>
            );
          })}
          <button className="secondary" onClick={() => setChildPickerOpen(false)}>
            {t.person.cancel}
          </button>
        </div>
      )}

      <form className="person-form" onSubmit={(e) => e.preventDefault()}>
        <label>
          {t.person.givenName}
          <input value={draft.given} onChange={(e) => edit({ given: e.target.value })} />
        </label>
        <label>
          {t.person.familyName}
          <input value={draft.family} onChange={(e) => edit({ family: e.target.value })} />
        </label>
        <label>
          {t.person.nicknames}
          <input
            value={draft.nicknames}
            onChange={(e) => edit({ nicknames: e.target.value })}
          />
        </label>
        <label>
          {t.person.sex}
          <select value={draft.sex} onChange={(e) => edit({ sex: e.target.value as Sex })}>
            {SEX_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend>{t.person.bornLegend}</legend>
          <input
            placeholder={t.person.dateHint}
            value={draft.birthDate}
            onChange={(e) => edit({ birthDate: e.target.value })}
          />
          <label className="inline">
            <input
              type="checkbox"
              checked={draft.birthApprox}
              onChange={(e) => edit({ birthApprox: e.target.checked })}
            />
            {t.person.approximate}
          </label>
          <input
            placeholder={t.person.place}
            value={draft.birthPlace}
            onChange={(e) => edit({ birthPlace: e.target.value })}
          />
        </fieldset>

        <fieldset>
          <legend>{t.person.diedLegend}</legend>
          <label className="inline">
            <input
              type="checkbox"
              checked={draft.deceased}
              onChange={(e) => edit({ deceased: e.target.checked })}
            />
            {t.person.deceased}
          </label>
          {draft.deceased && (
            <>
              <input
                placeholder={t.person.deathHint}
                value={draft.deathDate}
                onChange={(e) => edit({ deathDate: e.target.value })}
              />
              <label className="inline">
                <input
                  type="checkbox"
                  checked={draft.deathApprox}
                  onChange={(e) => edit({ deathApprox: e.target.checked })}
                />
                {t.person.approximate}
              </label>
              <input
                placeholder={t.person.place}
                value={draft.deathPlace}
                onChange={(e) => edit({ deathPlace: e.target.value })}
              />
            </>
          )}
        </fieldset>

        <label className="notes">
          {t.person.notes}
          <textarea
            rows={5}
            placeholder={t.person.notesHint}
            value={draft.notes}
            onChange={(e) => edit({ notes: e.target.value })}
          />
        </label>
      </form>

      <RelativesSection title={t.person.parents} ids={relatives.parents} tree={tree} onSelect={onSelect} />
      <RelativesSection title={t.person.spouses} ids={relatives.spouses} tree={tree} onSelect={onSelect} />
      <RelativesSection title={t.person.children} ids={relatives.children} tree={tree} onSelect={onSelect} />

      <button className="delete-btn" disabled={busy} onClick={handleDelete}>
        {t.person.delete}
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
