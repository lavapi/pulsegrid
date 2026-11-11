'use client';

import {
  DEPLOYMENT_STAGES,
  type DeploymentSide,
  isActiveTrafficDeployment,
  type ServiceDeploymentsView,
  type TrafficDeployment,
} from '@pulsegrid/shared';
import { Check, CircleDot, Webhook, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { Time } from '@/components/ui/time';
import { apiSendForJson } from '@/lib/browser-api';
import {
  deploymentStatusLabel,
  deploymentStatusTone,
  STRATEGY_LABELS,
  type StepState,
  stepStates,
} from '@/lib/service-deployments';
import { cn } from '@/lib/utils';

const ACTIVE_REFRESH_MS = 5_000;
const IDLE_REFRESH_MS = 30_000;

const STEP_ICONS: Record<StepState, typeof Check> = { done: Check, current: CircleDot, failed: X, upcoming: CircleDot };
const STEP_STYLES: Record<StepState, string> = {
  done: 'text-success',
  current: 'text-warning',
  failed: 'text-danger',
  upcoming: 'text-faint',
};

function Stages({ deployment }: { deployment: TrafficDeployment }) {
  const states = stepStates(deployment);
  return (
    <ol className="grid gap-2 sm:grid-cols-5" aria-label="Stages">
      {DEPLOYMENT_STAGES.map(({ id, label }) => {
        const Icon = STEP_ICONS[states[id]];
        return (
          <li key={id} className={cn('flex flex-col gap-1 rounded-lg border px-3 py-2 text-[13px]', states[id] === 'current' && 'border-warning')}>
            <span className={cn('flex items-center gap-1.5 font-medium', STEP_STYLES[states[id]])}>
              <Icon className="size-3.5" aria-hidden="true" />
              <span className="text-foreground">{label}</span>
            </span>
            {id === 'bake-time' && deployment.bakeTimeMinutes !== null && (
              <span className="text-[12px] text-muted-foreground">{deployment.bakeTimeMinutes} min</span>
            )}
            {deployment.hookStages.includes(id) && (
              <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
                <Webhook className="size-3" aria-hidden="true" />
                Runs your hook
              </span>
            )}
            <span className="sr-only">{states[id]}</span>
          </li>
        );
      })}
    </ol>
  );
}

const trafficText = ({ testTrafficPercent, productionTrafficPercent }: DeploymentSide): string | null => {
  const parts = [
    productionTrafficPercent !== null && `${productionTrafficPercent}% of live traffic`,
    testTrafficPercent !== null && `${testTrafficPercent}% of test traffic`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
};

function Side({ title, side }: { title: string; side: DeploymentSide | null }) {
  if (!side) {
    return null;
  }
  const traffic = trafficText(side);
  return (
    <section className="flex flex-col gap-1 rounded-lg border p-3 text-[13px]" aria-label={title}>
      <h3 className="text-xs font-semibold text-faint">{title}</h3>
      <span className="font-medium">{side.taskDefinition ?? side.revision}</span>
      <span className="text-muted-foreground">
        {side.runningTasks} of {side.requestedTasks} {side.requestedTasks === 1 ? 'task' : 'tasks'} running
      </span>
      {traffic && <span className="text-muted-foreground">{traffic}</span>}
      {side.images.map((image) => (
        <code key={image} className="break-all text-[12px] text-muted-foreground">
          {image}
        </code>
      ))}
    </section>
  );
}

function Current({ deployment }: { deployment: TrafficDeployment }) {
  const reason = deployment.rollbackReason ?? deployment.reason;
  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <Badge tone={deploymentStatusTone(deployment.status)} dot>
          {deploymentStatusLabel(deployment.status)}
        </Badge>
        {deployment.startedAt && (
          <span className="text-muted-foreground">
            Started <Time value={deployment.startedAt} />
          </span>
        )}
        {deployment.finishedAt && (
          <span className="text-muted-foreground">
            Ended <Time value={deployment.finishedAt} />
          </span>
        )}
      </div>
      {reason && <p className="text-[13px]">{deployment.rollbackReason ? `Rolled back: ${reason}` : reason}</p>}
      <Stages deployment={deployment} />
      <div className="grid gap-3 md:grid-cols-2">
        <Side title="Blue · live before this deployment" side={deployment.blue} />
        <Side title="Green · new revision" side={deployment.green} />
      </div>
    </div>
  );
}

function Earlier({ deployments }: { deployments: readonly TrafficDeployment[] }) {
  return (
    <div className="border-t px-5 py-3">
      <h3 className="pb-2 text-xs font-semibold text-faint">Earlier deployments</h3>
      <ul className="flex flex-col gap-1.5 text-[13px]">
        {deployments.map((deployment) => (
          <li key={deployment.id} className="flex flex-wrap items-center gap-3">
            <Badge tone={deploymentStatusTone(deployment.status)}>{deploymentStatusLabel(deployment.status)}</Badge>
            <span>{deployment.green?.taskDefinition ?? deployment.id}</span>
            {deployment.startedAt && (
              <span className="text-muted-foreground">
                <Time value={deployment.startedAt} />
              </span>
            )}
            {deployment.rollbackReason && <span className="text-muted-foreground">{deployment.rollbackReason}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Blue/green, canary and linear deployments of an ECS service. Rolling services show nothing here. */
export function ServiceDeployments({ resourceId }: { resourceId: string }) {
  const [view, setView] = useState<ServiceDeploymentsView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const active = view?.deployments[0] ? isActiveTrafficDeployment(view.deployments[0].status) : false;

  useEffect(() => {
    let current = true;
    const load = () =>
      void apiSendForJson<ServiceDeploymentsView>(`/resources/${resourceId}/deployments`, 'GET').then(({ data, error }) => {
        if (current) {
          setView(data);
          setFailure(error);
        }
      });
    load();
    const timer = setInterval(load, active ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [resourceId, active]);

  if (!view || view.strategy === 'rolling' || view.strategy === null) {
    return failure || view?.error ? (
      <Card>
        <CardHeader title="Deployments" />
        <p className="p-5 text-sm text-danger">{failure ?? view?.error}</p>
      </Card>
    ) : null;
  }
  const [latest, ...earlier] = view.deployments;
  return (
    <Card>
      <CardHeader
        title={`${STRATEGY_LABELS[view.strategy]} deployment`}
        description="From ECS, refreshed every 5 seconds while a deployment runs."
      />
      {view.error && <p className="px-5 pt-4 text-sm text-danger">{view.error}</p>}
      {latest ? <Current deployment={latest} /> : <p className="p-5 text-[13px] text-muted-foreground">No deployments yet.</p>}
      {earlier.length > 0 && <Earlier deployments={earlier} />}
    </Card>
  );
}
