'use client';

import { isSyncRunning, type SyncAccountProgress, type SyncProgress } from '@pulsegrid/shared';
import { Check, Circle, Loader2, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { syncTitle } from '@/lib/sync-progress';
import { cn } from '@/lib/utils';
import { useSyncProgress } from './sync-progress-provider';

const pluralResources = (count: number): string =>
  `${count} ${count === 1 ? 'resource' : 'resources'}`;

const accountLine = ({ state, reading, resources }: SyncAccountProgress): string => {
  if (state === 'waiting') {
    return 'Waiting';
  }
  if (state === 'done') {
    return pluralResources(resources);
  }
  return reading.length > 0 ? `Reading ${reading.join(', ')}` : 'Starting';
};

function AccountIcon({ state }: Pick<SyncAccountProgress, 'state'>) {
  if (state === 'done') {
    return <Check className="size-4 shrink-0 text-success" aria-hidden="true" />;
  }
  return state === 'running' ? (
    <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
  ) : (
    <Circle className="size-4 shrink-0 text-faint" aria-hidden="true" />
  );
}

function AccountRow({ account }: { account: SyncAccountProgress }) {
  return (
    <li className="px-5 py-2.5 text-[13px]">
      <div className="flex items-center gap-3">
        <AccountIcon state={account.state} />
        <span className="min-w-0 flex-1 truncate font-medium">{account.name}</span>
        <span className="truncate text-muted-foreground">{accountLine(account)}</span>
      </div>
      {account.issues.map((issue) => (
        <p className="ml-7 mt-1 flex items-center gap-1.5 text-xs text-warning" key={issue}>
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          {issue}
        </p>
      ))}
    </li>
  );
}

function SyncCard({ sync }: { sync: SyncProgress }) {
  const { dismiss } = useSyncProgress();
  const running = isSyncRunning(sync);
  const failed = sync.phase === 'failed';

  return (
    <Card className={cn(running && 'border-primary/40', failed && 'border-danger/40')}>
      <div className="flex items-center gap-3 px-5 py-4" role="status">
        <p className="min-w-0 flex-1 text-sm font-semibold">{syncTitle(sync)}</p>
        {running ? (
          <span className="text-[13px] tabular-nums text-muted-foreground">{sync.percent}%</span>
        ) : (
          <Button size="sm" variant="ghost" aria-label="Dismiss" onClick={() => dismiss(sync)}>
            <X />
          </Button>
        )}
      </div>
      {running && (
        <div className="px-5 pb-4">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Sync progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={sync.percent}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${sync.percent}%` }}
            />
          </div>
        </div>
      )}
      {sync.accounts.length > 0 && (
        <ul className="divide-y border-t">
          {sync.accounts.map((account) => (
            <AccountRow account={account} key={account.id} />
          ))}
        </ul>
      )}
    </Card>
  );
}

export function SyncProgressCards() {
  const { syncs } = useSyncProgress();
  return syncs.map((sync) => <SyncCard sync={sync} key={sync.key} />);
}
