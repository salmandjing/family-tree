/**
 * A tiny global "Working…" indicator. Heavy, tree-replacing operations (restore
 * a version, delete-forever, import) wrap themselves in `run()` so the user
 * always sees feedback instead of a seemingly-frozen screen.
 */

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { t } from '../i18n';

interface BusyValue {
  /** Run an async operation while showing the global "Working…" overlay. */
  run: <T>(fn: () => Promise<T>) => Promise<T>;
  busy: boolean;
}

const BusyContext = createContext<BusyValue | null>(null);

export function BusyProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setCount((c) => c + 1);
    try {
      return await fn();
    } finally {
      setCount((c) => c - 1);
    }
  }, []);

  return (
    <BusyContext.Provider value={{ run, busy: count > 0 }}>
      {children}
      {count > 0 && (
        <div className="busy-overlay" role="status" aria-live="polite">
          <div className="busy-card">
            <span className="busy-spinner" aria-hidden />
            {t.working}
          </div>
        </div>
      )}
    </BusyContext.Provider>
  );
}

export function useBusy(): BusyValue {
  const ctx = useContext(BusyContext);
  if (!ctx) throw new Error('useBusy must be used within a BusyProvider');
  return ctx;
}
