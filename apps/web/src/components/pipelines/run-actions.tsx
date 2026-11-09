'use client';

import { isActivePipelineStatus, type PipelineRun } from '@pulsegrid/shared';
import { RotateCcw, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ActionDialog } from './action-dialog';
import { usePipelineAction } from './use-pipeline-action';

export function RunActions({
  appId,
  run,
  rerunsFailedJobs,
}: {
  appId: string;
  run: PipelineRun;
  rerunsFailedJobs: boolean;
}) {
  const { pending, send } = usePipelineAction();
  const target = { appId, runId: run.id };

  if (isActivePipelineStatus(run.status)) {
    return (
      <ActionDialog
        trigger={
          <Button variant="dangerGhost" disabled={pending}>
            <Square />
            Cancel run
          </Button>
        }
        title="Cancel this run?"
        description="Jobs that are running will stop."
        confirmLabel="Cancel run"
        danger
        pending={pending}
        onConfirm={() => send('/pipelines/runs/cancel', target, 'Cancelling run')}
      />
    );
  }

  const rerun = (failedOnly: boolean, label: string, description: string) => (
    <ActionDialog
      trigger={
        <Button disabled={pending}>
          <RotateCcw />
          {label}
        </Button>
      }
      title={`${label}?`}
      description={description}
      confirmLabel={label}
      pending={pending}
      onConfirm={() => send('/pipelines/runs/rerun', { ...target, failedOnly }, 'Run started again')}
    />
  );

  return (
    <>
      {rerunsFailedJobs &&
        run.status === 'failure' &&
        rerun(true, 'Re-run failed jobs', 'Only the jobs that failed will run again.')}
      {rerun(false, 'Re-run', 'Every job in this run will run again.')}
    </>
  );
}
