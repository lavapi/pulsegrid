'use client';

import { type ActionRun, CLOUD_ACTIONS, type ResourceActionOption } from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ActionDialog } from '@/components/pipelines/action-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { apiSendForJson } from '@/lib/browser-api';
import { ActionRunCard } from './action-run-card';

const POLL_MS = 5000;

interface ResourceActionPanelProps {
  resourceId: string;
  resourceName: string;
  actions: ResourceActionOption[];
  initialRun: ActionRun | null;
}

export function ResourceActionPanel({ resourceId, resourceName, actions, initialRun }: ResourceActionPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [run, setRun] = useState(initialRun);
  const shown = useRef(initialRun?.status ?? null);
  const path = `/resources/${resourceId}/actions`;
  const inProgress = run?.status === 'running';
  const blockedReason = actions.find((action) => action.blockedReason)?.blockedReason;

  useEffect(() => {
    const timer = setInterval(async () => {
      const { data, error } = await apiSendForJson<ActionRun | null>(`${path}/runs/latest`, 'GET');
      if (error) {
        return;
      }
      if (shown.current === 'running' && data?.status !== 'running') {
        router.refresh();
      }
      shown.current = data?.status ?? null;
      setRun(data);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [path, router]);

  const start = ({ permission }: ResourceActionOption) => {
    startTransition(async () => {
      const { data, error } = await apiSendForJson<ActionRun>(`${path}/${permission}`, 'POST');
      if (error) {
        toast.error(error);
        return;
      }
      shown.current = data?.status ?? null;
      setRun(data);
      toast.success(CLOUD_ACTIONS[permission].success);
    });
  };

  return (
    <>
      {run && <ActionRunCard run={run} />}
      {actions.length > 0 && (
        <Card>
          <CardHeader title="Actions" />
          {blockedReason ? (
            <p className="p-5 text-sm text-muted">{blockedReason}</p>
          ) : (
            <div className="flex flex-wrap gap-2 p-5">
              {actions.map((action) => {
                const { buttonLabel, description } = CLOUD_ACTIONS[action.permission];
                return (
                  <ActionDialog
                    key={action.permission}
                    trigger={<Button disabled={pending || inProgress}>{buttonLabel}</Button>}
                    title={`${buttonLabel}: ${resourceName}?`}
                    description={description}
                    confirmLabel={buttonLabel}
                    pending={pending}
                    danger
                    onConfirm={() => start(action)}
                  />
                );
              })}
            </div>
          )}
        </Card>
      )}
    </>
  );
}
