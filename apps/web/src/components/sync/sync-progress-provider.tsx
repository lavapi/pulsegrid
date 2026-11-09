'use client';

import { isSyncRunning, type SyncProgress } from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { apiSendForJson } from '@/lib/browser-api';
import { syncId, visibleSyncs } from '@/lib/sync-progress';

const POLL_INTERVAL_MS = 2000;
const FINISHED_VISIBLE_MS = 10_000;

interface SyncProgressContextValue {
  syncs: SyncProgress[];
  running: boolean;
  follow: () => Promise<void>;
  dismiss: (sync: SyncProgress) => void;
}

const SyncProgressContext = createContext<SyncProgressContextValue | null>(null);

export const useSyncProgress = (): SyncProgressContextValue => {
  const value = useContext(SyncProgressContext);
  if (!value) {
    throw new Error('useSyncProgress needs a SyncProgressProvider.');
  }
  return value;
};

export function SyncProgressProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [all, setAll] = useState<SyncProgress[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const wasRunning = useRef(false);

  const follow = useCallback(async () => {
    const { data } = await apiSendForJson<SyncProgress[]>('/cloud/sync-progress', 'GET');
    if (data) {
      setAll(data);
    }
  }, []);

  const dismiss = useCallback((sync: SyncProgress) => {
    setDismissed((items) => [...items, syncId(sync)]);
  }, []);

  const syncs = useMemo(() => visibleSyncs(all, dismissed), [all, dismissed]);
  const running = all.some(isSyncRunning);

  useEffect(() => {
    void follow();
  }, [follow]);

  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = setInterval(() => void follow(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [follow, running]);

  useEffect(() => {
    if (wasRunning.current && !running) {
      router.refresh();
    }
    wasRunning.current = running;
  }, [router, running]);

  useEffect(() => {
    const finished = syncs.filter(({ phase }) => phase === 'finished');
    if (finished.length === 0) {
      return;
    }
    const timer = setTimeout(() => finished.forEach(dismiss), FINISHED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [dismiss, syncs]);

  const value = useMemo(
    () => ({ syncs, running, follow, dismiss }),
    [dismiss, follow, running, syncs],
  );
  return <SyncProgressContext.Provider value={value}>{children}</SyncProgressContext.Provider>;
}
