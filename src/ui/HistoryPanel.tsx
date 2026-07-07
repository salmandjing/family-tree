/** History screen (spec §4.2): restore one of the last local snapshots. */

import { useEffect, useState } from 'react';
import { useTree, useTreeService } from '../app/TreeContext';
import { useBusy } from '../app/BusyContext';
import type { Snapshot } from '../store/schema';
import { timeAgo } from '../sync/status';

export function HistoryPanel({ onClose }: { onClose: () => void }) {
  const service = useTreeService();
  const tree = useTree();
  const { run, busy } = useBusy();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);

  useEffect(() => {
    service.listSnapshots().then(setSnapshots);
  }, [service, tree]);

  async function restore(revision: number) {
    if (!confirm('Restore your tree to this earlier version? Your current version stays in history.')) {
      return;
    }
    await run(() => service.restoreSnapshot(revision));
    onClose();
  }

  return (
    <aside className="panel history-panel" role="dialog" aria-label="History">
      <div className="panel-header">
        <h2>History</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <p className="hint">Each save is kept here. Restore any earlier version.</p>
      <ul>
        {snapshots.map((s) => (
          <li key={s.revision}>
            <div>
              <strong>Version {s.revision}</strong>
              <span className="dates"> · {timeAgo(s.savedAt)}</span>
              <span className="count"> · {s.tree.persons.filter((p) => !p.deletedAt).length} people</span>
            </div>
            <button disabled={busy || s.revision === tree.revision} onClick={() => restore(s.revision)}>
              {s.revision === tree.revision ? 'Current' : 'Restore'}
            </button>
          </li>
        ))}
        {snapshots.length === 0 && <li className="empty">No history yet.</li>}
      </ul>
    </aside>
  );
}
