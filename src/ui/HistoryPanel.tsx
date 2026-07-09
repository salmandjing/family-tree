/** History screen (spec §4.2): restore one of the last local snapshots. */

import { useEffect, useState } from 'react';
import { useTree, useTreeService } from '../app/TreeContext';
import { useBusy } from '../app/BusyContext';
import type { Snapshot } from '../store/schema';
import { timeAgo } from '../sync/status';
import { t } from '../i18n';

export function HistoryPanel({ onClose }: { onClose: () => void }) {
  const service = useTreeService();
  const tree = useTree();
  const { run, busy } = useBusy();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);

  useEffect(() => {
    service.listSnapshots().then(setSnapshots);
  }, [service, tree]);

  async function restore(revision: number) {
    if (!confirm(t.history.confirm)) {
      return;
    }
    await run(() => service.restoreSnapshot(revision));
    onClose();
  }

  return (
    <aside className="panel history-panel" role="dialog" aria-label={t.history.title}>
      <div className="panel-header">
        <h2>{t.history.title}</h2>
        <button className="icon-btn" onClick={onClose} aria-label={t.person.close}>
          ✕
        </button>
      </div>
      <p className="hint">{t.history.hint}</p>
      <ul>
        {snapshots.map((s) => (
          <li key={s.revision}>
            <div>
              <strong>{t.history.version(s.revision)}</strong>
              <span className="dates"> · {timeAgo(s.savedAt)}</span>
              <span className="count"> · {t.history.people(s.tree.persons.filter((p) => !p.deletedAt).length)}</span>
            </div>
            <button disabled={busy || s.revision === tree.revision} onClick={() => restore(s.revision)}>
              {s.revision === tree.revision ? t.history.current : t.history.restore}
            </button>
          </li>
        ))}
        {snapshots.length === 0 && <li className="empty">{t.history.empty}</li>}
      </ul>
    </aside>
  );
}
