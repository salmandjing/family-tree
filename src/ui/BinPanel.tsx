/** Recently deleted bin (spec §4.3): restore or permanently remove. */

import { useState } from 'react';
import { useTree, useTreeService } from '../app/TreeContext';
import { deletedPersons } from '../core/operations';
import { BIN_RETENTION_DAYS } from '../store/schema';
import { displayName } from './format';
import { PhotoThumb } from './PhotoThumb';

export function BinPanel({ onClose }: { onClose: () => void }) {
  const service = useTreeService();
  const tree = useTree();
  const [busy, setBusy] = useState(false);
  const people = deletedPersons(tree);

  async function restore(id: string) {
    setBusy(true);
    try {
      await service.restoreDeletedPerson(id);
    } finally {
      setBusy(false);
    }
  }

  async function purge(id: string, name: string) {
    if (!confirm(`Permanently delete ${name}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await service.purgePersonNow(id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="panel bin-panel" role="dialog" aria-label="Recently deleted">
      <div className="panel-header">
        <h2>Recently deleted</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <p className="hint">
        Deleted people are kept for {BIN_RETENTION_DAYS} days, then removed automatically.
      </p>
      <ul>
        {people.map((p) => (
          <li key={p.id}>
            <span className="who">
              <PhotoThumb photoId={p.photos[0]} alt={displayName(p)} className="tiny" />
              {displayName(p)}
            </span>
            <span className="row-actions">
              <button disabled={busy} onClick={() => restore(p.id)}>
                Restore
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() => purge(p.id, displayName(p))}
              >
                Delete forever
              </button>
            </span>
          </li>
        ))}
        {people.length === 0 && <li className="empty">Nothing here.</li>}
      </ul>
    </aside>
  );
}
