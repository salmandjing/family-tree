/** First-run empty state: one big button to add the first person (spec §9). */

import { useState } from 'react';
import { useTreeService } from '../app/TreeContext';
import { addPerson } from '../core/operations';
import { t } from '../i18n';

export function EmptyState({ onCreated }: { onCreated: (id: string) => void }) {
  const service = useTreeService();
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      let id = '';
      await service.apply((t, clock) => {
        const r = addPerson(t, { given: '' }, clock);
        id = r.person.id;
        return r.tree;
      });
      onCreated(id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="empty-state">
      <div className="empty-inner">
        <div className="tree-emoji" aria-hidden>
          🌳
        </div>
        <h2>{t.empty.heading}</h2>
        <p>{t.empty.desc}</p>
        <button className="big-btn primary" disabled={busy} onClick={start}>
          {t.empty.button}
        </button>
      </div>
    </div>
  );
}
