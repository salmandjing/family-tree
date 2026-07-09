/** App shell: passphrase gate → workspace (toolbar, tree canvas, person card,
 *  panels, live backup status, conflict dialog). Spec §9. */

import { useState } from 'react';
import { TreeProvider, useTree } from './app/TreeContext';
import { BusyProvider } from './app/BusyContext';
import { useSync } from './app/useSync';
import { backupEnabled, getStoredPassphrase } from './app/config';
import { hasRenderableData } from './render/adapter';
import { Toolbar } from './ui/Toolbar';
import { TreeCanvas } from './ui/TreeCanvas';
import { PersonCard } from './ui/PersonCard';
import { EmptyState } from './ui/EmptyState';
import { HistoryPanel } from './ui/HistoryPanel';
import { BinPanel } from './ui/BinPanel';
import { HelpPanel } from './ui/HelpPanel';
import { StatusBar } from './ui/StatusBar';
import { PassphraseGate } from './ui/PassphraseGate';
import { ConflictDialog } from './ui/ConflictDialog';
import { t } from './i18n';

type Panel = 'none' | 'history' | 'bin' | 'help';

function Workspace() {
  const tree = useTree();
  const { status, conflict, resolveConflict, retry } = useSync();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | undefined>(undefined);
  const [fitNonce, setFitNonce] = useState(0);
  const [panel, setPanel] = useState<Panel>('none');

  const select = (id: string) => {
    setSelectedId(id);
    setFocusId(id);
  };

  // Close any open card and zoom out to the whole tree.
  const showWholeTree = () => {
    setSelectedId(null);
    setFocusId(undefined);
    setFitNonce((n) => n + 1);
  };

  return (
    <div className="app">
      <Toolbar
        onPick={select}
        onOpenHistory={() => setPanel('history')}
        onOpenBin={() => setPanel('bin')}
        onOpenHelp={() => setPanel('help')}
      />

      <main className="workspace">
        {hasRenderableData(tree) ? (
          <>
            <TreeCanvas onSelect={select} focusId={focusId} fitNonce={fitNonce} />
            <button
              className="whole-tree-btn"
              onClick={showWholeTree}
              aria-label={t.wholeTreeAria}
            >
              {t.wholeTree}
            </button>
          </>
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
      {panel === 'help' && <HelpPanel onClose={() => setPanel('none')} />}

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
      <BusyProvider>
        <Workspace />
      </BusyProvider>
    </TreeProvider>
  );
}
