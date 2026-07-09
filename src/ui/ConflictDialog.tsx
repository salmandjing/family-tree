/**
 * Conflict dialog (spec §6). Plain language, three explicit choices, no silent
 * merge or overwrite.
 */

import { useState } from 'react';
import type { PendingConflict, ConflictChoice } from '../sync/syncClient';
import { timeAgo } from '../sync/status';
import { t } from '../i18n';

interface ConflictDialogProps {
  conflict: PendingConflict;
  onResolve: (choice: ConflictChoice) => Promise<void>;
}

export function ConflictDialog({ conflict, onResolve }: ConflictDialogProps) {
  const [busy, setBusy] = useState(false);

  async function choose(choice: ConflictChoice) {
    setBusy(true);
    try {
      await onResolve(choice);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t.conflict.aria}>
      <div className="modal conflict">
        <h2>{t.conflict.title}</h2>
        <p>{t.conflict.body(timeAgo(conflict.remoteSavedAt))}</p>
        <div className="conflict-choices">
          <button className="big-btn" disabled={busy} onClick={() => choose('local')}>
            {t.conflict.keepLocal}
          </button>
          <button className="big-btn" disabled={busy} onClick={() => choose('remote')}>
            {t.conflict.keepRemote}
          </button>
          <button className="big-btn" disabled={busy} onClick={() => choose('both')}>
            {t.conflict.keepBoth}
          </button>
        </div>
        <p className="hint">{t.conflict.hint}</p>
      </div>
    </div>
  );
}
