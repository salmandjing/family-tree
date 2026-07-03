/**
 * Lock screen (spec §7). A visitor without the passphrase sees only this. When
 * a Worker is configured the passphrase is verified against it (a wrong one is
 * rejected here); otherwise any non-empty passphrase unlocks the local-only app.
 */

import { useState, type FormEvent } from 'react';
import { backupEnabled, setStoredPassphrase, workerUrl } from '../app/config';
import { HttpWorkerApi } from '../sync/workerApi';

export function PassphraseGate({ onUnlock }: { onUnlock: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const pass = value.trim();
    if (!pass) {
      setError('Please enter the family password.');
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
      setError(
        /passphrase/i.test(msg)
          ? 'That password is not correct.'
          : `Could not reach the backup service. You can still work offline. (${msg})`,
      );
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
        <h1>Family Tree</h1>
        <p>Enter the family password to continue.</p>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Family password"
          aria-label="Family password"
        />
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        <button className="big-btn primary" disabled={busy} type="submit">
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
