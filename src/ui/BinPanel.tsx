/** Recently deleted bin (spec §4.3): restore or permanently remove. */

import { useTree, useTreeService } from '../app/TreeContext';
import { useBusy } from '../app/BusyContext';
import { deletedPersons } from '../core/operations';
import { BIN_RETENTION_DAYS } from '../store/schema';
import { displayName } from './format';
import { PhotoThumb } from './PhotoThumb';
import { t } from '../i18n';

export function BinPanel({ onClose }: { onClose: () => void }) {
  const service = useTreeService();
  const tree = useTree();
  const { run, busy } = useBusy();
  const people = deletedPersons(tree);

  async function restore(id: string) {
    await run(() => service.restoreDeletedPerson(id));
  }

  async function purge(id: string, name: string) {
    if (!confirm(t.bin.confirm(name))) return;
    await run(() => service.purgePersonNow(id));
  }

  return (
    <aside className="panel bin-panel" role="dialog" aria-label={t.bin.title}>
      <div className="panel-header">
        <h2>{t.bin.title}</h2>
        <button className="icon-btn" onClick={onClose} aria-label={t.person.close}>
          ✕
        </button>
      </div>
      <p className="hint">{t.bin.hint(BIN_RETENTION_DAYS)}</p>
      <ul>
        {people.map((p) => (
          <li key={p.id}>
            <span className="who">
              <PhotoThumb photoId={p.photos[0]} alt={displayName(p)} className="tiny" />
              {displayName(p)}
            </span>
            <span className="row-actions">
              <button disabled={busy} onClick={() => restore(p.id)}>
                {t.bin.restore}
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() => purge(p.id, displayName(p))}
              >
                {t.bin.deleteForever}
              </button>
            </span>
          </li>
        ))}
        {people.length === 0 && <li className="empty">{t.bin.empty}</li>}
      </ul>
    </aside>
  );
}
