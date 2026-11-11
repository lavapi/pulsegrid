'use client';

import type { RunOrder, StartedExperimentRun } from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { ProductionNotice, useProductionTarget } from '@/components/ui/production-notice';
import { apiSendForJson } from '@/lib/browser-api';
import { experimentRunPath } from '@/lib/experiments';

interface RunTestsButtonProps {
  accountId: string;
  /** The group to run, or none to run every template. */
  groupId?: string;
  label: string;
  templateLabels: string[];
  triggerLabel: string;
}

function RunOrderList({ order }: { order: RunOrder | null }) {
  if (!order) {
    return <p className="text-[13px] text-muted-foreground">Working out the order…</p>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[13px] text-muted-foreground">
        Tests run one at a time in this order. Each starts only when the one before has ended and every service, load
        balancer target, database and cache is healthy again.
      </p>
      <ol className="max-h-48 list-decimal overflow-y-auto rounded-lg bg-muted py-2 pr-3 pl-8 text-[13px]">
        {order.tests.map(({ label, zoneWide }, index) => (
          <li key={`${index}-${label}`}>
            {label}
            {zoneWide && <span className="text-muted-foreground"> · zone-wide, runs last</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Shows the order the tests run in, one at a time, and starts the run once confirmed. */
export function RunTestsButton({ accountId, groupId, label, templateLabels, triggerLabel }: RunTestsButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const production = useProductionTarget(true);
  const [order, setOrder] = useState<RunOrder | null>(null);
  const [typed, setTyped] = useState('');
  const [understood, setUnderstood] = useState(false);
  const blocked = Boolean(production && order?.busy);
  const ready = order !== null && !blocked && typed.trim() === label && (!production || understood);

  const change = (next: boolean) => {
    setOpen(next);
    setTyped('');
    setUnderstood(false);
    setOrder(null);
    if (next) {
      const query = groupId ? `?groupId=${encodeURIComponent(groupId)}` : '';
      void apiSendForJson<RunOrder>(`/cloud/accounts/${accountId}/experiment-runs/order${query}`, 'GET').then(
        ({ data, error }) => {
          setOrder(data ?? { tests: templateLabels.map((name) => ({ label: name, zoneWide: false })), busy: null });
          if (error) {
            toast.error(error);
          }
        },
      );
    }
  };

  const run = () =>
    startTransition(async () => {
      const { data, error } = await apiSendForJson<StartedExperimentRun>(
        `/cloud/accounts/${accountId}/experiment-runs`,
        'POST',
        { ...(groupId ? { groupId } : {}), ...(production ? { confirmProduction: true } : {}) },
      );
      if (!data) {
        toast.error(error ?? 'The tests did not start. Please try again.');
        return;
      }
      setOpen(false);
      toast.success('Failover tests started');
      router.push(experimentRunPath(data.id));
    });

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button variant="danger" size="sm" disabled={pending || templateLabels.length === 0}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-base font-semibold">Start {templateLabels.length} failover tests?</DialogTitle>
        <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
          Each test deliberately breaks or slows the resources it targets until it finishes, a stop alarm fires, or
          someone stops it.
        </DialogDescription>
        <div className="mt-4 flex flex-col gap-4">
          <ProductionNotice target={production} />
          <RunOrderList order={order} />
          {order?.busy && (
            <p className="text-[13px] text-warning">
              {order.busy}{' '}
              {blocked ? 'Production runs only start when nothing else is running.' : 'The first test waits until it ends.'}
            </p>
          )}
          {production && (
            <label className="flex items-start gap-2 text-[13px]">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={understood}
                onChange={(event) => setUnderstood(event.target.checked)}
              />
              I understand this runs these tests in production, one at a time.
            </label>
          )}
          <Field label={`Type ${label} to confirm`}>
            <Input value={typed} autoComplete="off" onChange={(event) => setTyped(event.target.value)} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button>Cancel</Button>
          </DialogClose>
          <Button variant="danger" disabled={pending || !ready} onClick={run}>
            Start tests
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
