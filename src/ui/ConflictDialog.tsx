/**
 * Conflict dialog (spec §6). Plain language, three explicit choices, no silent
 * merge or overwrite.
 */

import { useState } from 'react';
import type { PendingConflict, ConflictChoice } from '../sync/syncClient';
import { timeAgo } from '../sync/status';

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
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Version conflict">
      <div className="modal conflict">
        <h2>This tree was edited on another device</h2>
        <p>
          The other version was saved {timeAgo(conflict.remoteSavedAt)}. Which one would
          you like to keep?
        </p>
        <div className="conflict-choices">
          <button className="big-btn" disabled={busy} onClick={() => choose('local')}>
            Keep this device's version
          </button>
          <button className="big-btn" disabled={busy} onClick={() => choose('remote')}>
            Keep the other version
          </button>
          <button className="big-btn" disabled={busy} onClick={() => choose('both')}>
            Keep both copies
          </button>
        </div>
        <p className="hint">
          “Keep both” keeps this device's version active and downloads the other version
          as a file so nothing is lost.
        </p>
      </div>
    </div>
  );
}
