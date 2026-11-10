import type { ExperimentStep, ExperimentTarget } from '@pulsegrid/shared';
import { BellRing, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatStepDuration, stateLabel, stateTone } from '@/lib/experiments';

export function StateBadge({ state }: { state: string }) {
  return (
    <Badge tone={stateTone(state)} dot>
      {stateLabel(state)}
    </Badge>
  );
}

export function TargetList({ targets }: { targets: readonly ExperimentTarget[] }) {
  return (
    <ul className="flex flex-col gap-1.5 text-[13px]">
      {targets.map((target) => (
        <li key={target.name}>
          <span className="font-medium">{target.name}</span>{' '}
          <code className="text-muted-foreground">{target.resourceType}</code>
          <span className="text-muted-foreground"> · {target.selection}</span>
        </li>
      ))}
    </ul>
  );
}

export function StepSummary({ step }: { step: ExperimentStep }) {
  const duration = formatStepDuration(step.duration);
  return (
    <span className="flex flex-col">
      <span className="font-medium">{step.name}</span>
      <span className="text-muted-foreground">
        <code>{step.actionId}</code>
        {duration && ` · ${duration}`}
        {step.description && ` · ${step.description}`}
      </span>
    </span>
  );
}

export function StopAlarms({ alarms }: { alarms: readonly string[] }) {
  if (alarms.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-[13px] text-warning">
        <TriangleAlert className="size-3.5" aria-hidden="true" />
        No stop alarm. Nothing stops this experiment early except a person.
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
      <BellRing className="size-3.5" aria-hidden="true" />
      Stops early if {alarms.length === 1 ? 'this alarm fires' : 'any of these alarms fire'}:
      {alarms.map((alarm) => (
        <code className="text-foreground" key={alarm}>
          {alarm}
        </code>
      ))}
    </p>
  );
}
