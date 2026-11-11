'use client';

import type { ExperimentCapacity, StartedExperimentRun } from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { apiSendForJson } from '@/lib/browser-api';
import { experimentRunPath, waveChoice } from '@/lib/experiments';

interface RunTestsButtonProps {
  accountId: string;
  /** The group to run, or none to run every template. */
  groupId?: string;
  label: string;
  templateLabels: string[];
  regions: string[];
  rememberedWaveSize?: number | null;
  triggerLabel: string;
}

function CapacityNote({ capacity, regions }: { capacity: ExperimentCapacity[]; regions: string[] }) {
  const relevant = capacity.filter(({ region }) => regions.includes(region));
  return (
    <ul className="flex flex-col gap-1 rounded-lg bg-muted px-3 py-2 text-[13px]">
      {relevant.map(({ region, quota, quotaKnown, running }) => (
        <li key={region}>
          AWS allows <strong>{quota}</strong> tests at once in this account in {region}
          {quotaKnown ? '' : " (AWS's default; PulseGrid couldn't read the account's quota)"}.{' '}
          <strong>{running}</strong> {running === 1 ? 'is' : 'are'} running now.
        </li>
      ))}
    </ul>
  );
}

/** Asks how many tests to run at a time, using the account's AWS quota, then starts the run. */
export function RunTestsButton({
  accountId,
  groupId,
  label,
  templateLabels,
  regions,
  rememberedWaveSize = null,
  triggerLabel,
}: RunTestsButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [capacity, setCapacity] = useState<ExperimentCapacity[] | null>(null);
  const [waveSize, setWaveSize] = useState('');
  const [typed, setTyped] = useState('');
  const choice = waveChoice(capacity ?? [], regions, templateLabels.length, rememberedWaveSize);
  const size = Number(waveSize);
  const validSize = Number.isInteger(size) && size >= 1 && size <= choice.max;

  const change = (next: boolean) => {
    setOpen(next);
    setTyped('');
    setCapacity(null);
    if (next) {
      void apiSendForJson<ExperimentCapacity[]>(`/cloud/accounts/${accountId}/experiment-runs/capacity`, 'GET').then(
        ({ data, error }) => {
          const loaded = data ?? [];
          setCapacity(loaded);
          setWaveSize(String(waveChoice(loaded, regions, templateLabels.length, rememberedWaveSize).suggested));
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
        { ...(groupId ? { groupId } : {}), waveSize: size },
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
          This runs {templateLabels.join(', ')}. Each deliberately breaks or slows the resources it targets until it
          finishes, a stop alarm fires, or someone stops it.
        </DialogDescription>
        <div className="mt-4 flex flex-col gap-4">
          {capacity === null ? (
            <p className="text-[13px] text-muted-foreground">Checking how many tests AWS allows at once…</p>
          ) : (
            <CapacityNote capacity={capacity} regions={regions} />
          )}
          <Field label={`Tests at a time, 1 to ${choice.max}`}>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={choice.max}
              value={waveSize}
              disabled={capacity === null}
              onChange={(event) => setWaveSize(event.target.value)}
            />
          </Field>
          {capacity !== null && validSize && size > choice.free && (
            <p className="text-[13px] text-warning">
              Only {choice.free} {choice.free === 1 ? 'slot is' : 'slots are'} free now, so some tests wait until
              others end.
            </p>
          )}
          <p className="text-[13px] text-muted-foreground">
            The rest wait and start as earlier tests end. Choose 1 to run them one after another.
          </p>
          <Field label={`Type ${label} to confirm`}>
            <Input value={typed} autoComplete="off" onChange={(event) => setTyped(event.target.value)} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button>Cancel</Button>
          </DialogClose>
          <Button
            variant="danger"
            disabled={pending || capacity === null || !validSize || typed.trim() !== label}
            onClick={run}
          >
            Start tests
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
