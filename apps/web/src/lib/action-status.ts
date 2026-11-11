import type { ActionRun, ActionRunStatus } from '@pulsegrid/shared';
import { CircleAlert, CircleCheck, CircleX, LoaderCircle, type LucideIcon } from 'lucide-react';

/** How each action status looks. Plain data, so server and browser components can both use it. */
export const STATUS_VIEWS: Record<
  ActionRunStatus,
  { label: string; tone: 'primary' | 'success' | 'danger' | 'warning'; icon: LucideIcon; color: string }
> = {
  running: { label: 'In progress', tone: 'primary', icon: LoaderCircle, color: 'animate-spin text-primary' },
  succeeded: { label: 'Finished', tone: 'success', icon: CircleCheck, color: 'text-success' },
  failed: { label: 'Failed', tone: 'danger', icon: CircleX, color: 'text-danger' },
  timed_out: { label: 'Timed out', tone: 'warning', icon: CircleAlert, color: 'text-warning' },
  unconfirmed: { label: 'Not confirmed', tone: 'warning', icon: CircleAlert, color: 'text-warning' },
};

export const startedByLabel = ({ startedBy }: ActionRun): string =>
  startedBy ? `Started by ${startedBy}` : 'Started outside the dashboard';
