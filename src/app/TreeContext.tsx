/**
 * React binding for the TreeService. Creates one service instance for the app,
 * initializes it, and exposes it plus the current tree (via useSyncExternalStore
 * so any commit re-renders subscribers).
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { LocalStore } from '../store/localStore';
import { TreeService } from './treeService';
import type { FamilyTree } from '../core/types';
import { t } from '../i18n';

interface TreeContextValue {
  service: TreeService;
  store: LocalStore;
}

const TreeContext = createContext<TreeContextValue | null>(null);

export function TreeProvider({ children }: { children: ReactNode }) {
  const [ctx, setCtx] = useState<TreeContextValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return; // guard React 18 StrictMode double-invoke
    startedRef.current = true;
    let created: TreeService | null = null;
    (async () => {
      try {
        const store = await LocalStore.open();
        created = new TreeService({ store });
        await created.init();
        setCtx({ service: created, store });
      } catch (e) {
        console.error('Failed to initialize local storage', e);
        setError(t.fatalStorage);
      }
    })();
    return () => {
      created?.dispose();
    };
  }, []);

  if (error) {
    return (
      <div className="fatal-error" role="alert">
        <h1>{t.fatalTitle}</h1>
        <p>{error}</p>
      </div>
    );
  }

  if (!ctx) {
    return (
      <div className="loading" role="status">
        {t.loading}
      </div>
    );
  }

  return <TreeContext.Provider value={ctx}>{children}</TreeContext.Provider>;
}

export function useTreeService(): TreeService {
  const ctx = useContext(TreeContext);
  if (!ctx) throw new Error('useTreeService must be used within a TreeProvider');
  return ctx.service;
}

export function useLocalStore(): LocalStore {
  const ctx = useContext(TreeContext);
  if (!ctx) throw new Error('useLocalStore must be used within a TreeProvider');
  return ctx.store;
}

/** Subscribe to the live tree; re-renders on every commit. */
export function useTree(): FamilyTree {
  const service = useTreeService();
  return useSyncExternalStore(
    (cb) => service.subscribe(cb),
    () => service.getTree(),
  );
}
