/** App shell: passphrase gate → workspace (toolbar, tree canvas, person card,
 *  panels, live backup status, conflict dialog). Spec §9. */

import { useState } from 'react';
import { TreeProvider, useTree } from './app/TreeContext';
import { useSync } from './app/useSync';
import { backupEnabled, getStoredPassphrase } from './app/config';
import { hasRenderableData } from './render/adapter';
import { Toolbar } from './ui/Toolbar';
import { TreeCanvas } from './ui/TreeCanvas';
import { PersonCard } from './ui/PersonCard';
import { EmptyState } from './ui/EmptyState';
import { HistoryPanel } from './ui/HistoryPanel';
import { BinPanel } from './ui/BinPanel';
import { StatusBar } from './ui/StatusBar';
import { PassphraseGate } from './ui/PassphraseGate';
import { ConflictDialog } from './ui/ConflictDialog';

type Panel = 'none' | 'history' | 'bin';

function Workspace() {
  const tree = useTree();
  const { status, conflict, resolveConflict, retry } = useSync();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | undefined>(undefined);
  const [panel, setPanel] = useState<Panel>('none');

  const select = (id: string) => {
    setSelectedId(id);
    setFocusId(id);
  };

  return (
    <div className="app">
      <Toolbar
        onPick={select}
        onOpenHistory={() => setPanel('history')}
        onOpenBin={() => setPanel('bin')}
      />

      <main className="workspace">
        {hasRenderableData(tree) ? (
          <TreeCanvas onSelect={select} focusId={focusId} />
        ) : (
          <EmptyState onCreated={select} />
        )}
      </main>

      {selectedId && (
        <PersonCard
          personId={selectedId}
          onSelect={select}
          onClose={() => setSelectedId(null)}
        />
      )}

      {panel === 'history' && <HistoryPanel onClose={() => setPanel('none')} />}
      {panel === 'bin' && <BinPanel onClose={() => setPanel('none')} />}

      {conflict && (
        <ConflictDialog conflict={conflict} onResolve={resolveConflict} />
      )}

      <StatusBar status={status} onRetry={retry} />
    </div>
  );
}

export function App() {
  // Gate: if backup is configured, require the passphrase before entering.
  const [unlocked, setUnlocked] = useState(
    () => !backupEnabled() || getStoredPassphrase() !== null,
  );

  if (!unlocked) {
    return <PassphraseGate onUnlock={() => setUnlocked(true)} />;
  }

  return (
    <TreeProvider>
      <Workspace />
    </TreeProvider>
  );
}
