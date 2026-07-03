/** Top toolbar: search, undo/redo, add-first-person, and access to History,
 *  Recently-deleted, and Export/Import (always reachable — spec §9 status bar). */

import { useRef, useState } from 'react';
import { useTree, useTreeService } from '../app/TreeContext';
import { addPerson } from '../core/operations';
import { deletedPersons } from '../core/operations';
import { SearchBox } from './SearchBox';

interface ToolbarProps {
  onPick: (id: string) => void;
  onOpenHistory: () => void;
  onOpenBin: () => void;
}

export function Toolbar({ onPick, onOpenHistory, onOpenBin }: ToolbarProps) {
  const service = useTreeService();
  const tree = useTree();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const binCount = deletedPersons(tree).length;

  async function addFirstPerson() {
    setBusy(true);
    try {
      let id = '';
      await service.apply((t, clock) => {
        const r = addPerson(t, { given: '' }, clock);
        id = r.person.id;
        return r.tree;
      });
      onPick(id);
    } finally {
      setBusy(false);
    }
  }

  async function doExport() {
    setError(null);
    try {
      const json = await service.exportJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `family-tree-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`);
    }
  }

  async function doImport(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const text = await file.text();
      await service.importJson(text);
    } catch (e) {
      setError(`Import failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  return (
    <header className="toolbar">
      <div className="toolbar-row">
        <h1 className="app-title">Family Tree</h1>
        <SearchBox onPick={onPick} />
      </div>
      <div className="toolbar-row actions">
        <button disabled={busy} onClick={addFirstPerson}>
          ＋ Add person
        </button>
        <button disabled={!service.canUndo() || busy} onClick={() => service.undo()}>
          ↶ Undo
        </button>
        <button disabled={!service.canRedo() || busy} onClick={() => service.redo()}>
          ↷ Redo
        </button>
        <button onClick={onOpenHistory}>History</button>
        <button onClick={onOpenBin}>
          Recently deleted{binCount > 0 ? ` (${binCount})` : ''}
        </button>
        <button onClick={doExport}>Download</button>
        <button disabled={busy} onClick={() => importInputRef.current?.click()}>
          Upload
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => doImport(e.target.files?.[0])}
        />
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
    </header>
  );
}
