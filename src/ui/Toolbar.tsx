/** Top toolbar: search, undo/redo, add-first-person, and access to History,
 *  Recently-deleted, and Export/Import (always reachable — spec §9 status bar). */

import { useRef, useState } from 'react';
import { useTree, useTreeService } from '../app/TreeContext';
import { useBusy } from '../app/BusyContext';
import { addPerson } from '../core/operations';
import { deletedPersons } from '../core/operations';
import { SearchBox } from './SearchBox';
import { t } from '../i18n';

interface ToolbarProps {
  onPick: (id: string) => void;
  onOpenHistory: () => void;
  onOpenBin: () => void;
  onOpenHelp: () => void;
}

export function Toolbar({ onPick, onOpenHistory, onOpenBin, onOpenHelp }: ToolbarProps) {
  const service = useTreeService();
  const tree = useTree();
  const { run } = useBusy();
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
      setError(t.toolbar.exportFailed((e as Error).message));
    }
  }

  async function doImport(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      await run(() => service.importJson(text));
    } catch (e) {
      setError(t.toolbar.importFailed((e as Error).message));
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  return (
    <header className="toolbar">
      <div className="toolbar-row">
        <h1 className="app-title">{t.appName}</h1>
        <SearchBox onPick={onPick} />
        <button className="help-btn" onClick={onOpenHelp} aria-label={t.toolbar.help}>
          ? {t.toolbar.help}
        </button>
      </div>
      <div className="toolbar-row actions">
        <button disabled={busy} onClick={addFirstPerson}>
          {t.toolbar.addPerson}
        </button>
        <button disabled={!service.canUndo() || busy} onClick={() => service.undo()}>
          {t.toolbar.undo}
        </button>
        <button disabled={!service.canRedo() || busy} onClick={() => service.redo()}>
          {t.toolbar.redo}
        </button>
        <button onClick={onOpenHistory}>{t.toolbar.history}</button>
        <button onClick={onOpenBin}>
          {t.toolbar.bin}{binCount > 0 ? ` (${binCount})` : ''}
        </button>
        <button onClick={doExport}>{t.toolbar.download}</button>
        <button disabled={busy} onClick={() => importInputRef.current?.click()}>
          {t.toolbar.upload}
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
