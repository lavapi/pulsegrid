'use client';

import type { ReactNode } from 'react';
import { useSyncProgress } from './sync-progress-provider';

export function WhileSyncing({ loading, children }: { loading: ReactNode; children?: ReactNode }) {
  const { running } = useSyncProgress();
  return running ? loading : children;
}
