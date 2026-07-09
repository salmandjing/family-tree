/**
 * Lock screen (spec §7). A visitor without the passphrase sees only this. When
 * a Worker is configured the passphrase is verified against it (a wrong one is
 * rejected here); otherwise any non-empty passphrase unlocks the local-only app.
 */

import { useState, type FormEvent } from 'react';
import { backupEnabled, setStoredPassphrase, workerUrl } from '../app/config';
import { HttpWorkerApi } from '../sync/workerApi';
import { t } from '../i18n';

export function PassphraseGate({ onUnlock }: { onUnlock: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const pass = value.trim();
    if (!pass) {
      setError(t.gate.empty);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const url = workerUrl();
      if (backupEnabled() && url) {
        // Verify against the Worker: a wrong passphrase returns 401.
        const api = new HttpWorkerApi(url, pass);
        await api.latestMeta();
      }
      setStoredPassphrase(pass);
      onUnlock();
    } catch (err) {
      const msg = (err as Error).message;
      setError(/passphrase/i.test(msg) ? t.gate.wrong : t.gate.network(msg));
      // If it was only a network problem, allow local-only entry.
      if (!/passphrase/i.test(msg)) {
        setStoredPassphrase(value.trim());
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <div className="tree-emoji" aria-hidden>
          🌳
        </div>
        <h1>{t.appName}</h1>
        <p>{t.gate.prompt}</p>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t.gate.placeholder}
          aria-label={t.gate.placeholder}
        />
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        <button className="big-btn primary" disabled={busy} type="submit">
          {busy ? t.gate.checking : t.gate.unlock}
        </button>
      </form>
    </div>
  );
}
