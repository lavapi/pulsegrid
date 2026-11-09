export type SyncPhase = 'queued' | 'reading' | 'finished' | 'failed';
export type SyncAccountState = 'waiting' | 'running' | 'done';

export interface SyncAccountProgress {
  id: string;
  name: string;
  state: SyncAccountState;
  reading: string[];
  resources: number;
  issues: string[];
  failedTasks: number;
  completedTasks: number;
  totalTasks: number;
}

export interface SyncProgress {
  key: string;
  accountId: string;
  phase: SyncPhase;
  percent: number;
  accounts: SyncAccountProgress[];
  message: string | null;
  startedAt: string;
}

export const isSyncRunning = ({ phase }: SyncProgress): boolean =>
  phase !== 'finished' && phase !== 'failed';
