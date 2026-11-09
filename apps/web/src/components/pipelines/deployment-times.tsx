import type { PipelineDeploymentTime } from '@pulsegrid/shared';
import { StatTile } from '@/components/ui/stat-tile';
import { formatDuration } from '@/lib/format';

const runCount = ({ runs }: PipelineDeploymentTime): string => {
  if (runs === 0) {
    return 'No deployments yet';
  }
  return runs === 1 ? 'Last run' : `Last ${runs} runs`;
};

export function DeploymentTimeTiles({ times }: { times: PipelineDeploymentTime[] }) {
  return (
    <section className="grid gap-3 sm:grid-cols-2" aria-label="Average deployment time">
      {times.map((time) => (
        <StatTile
          key={time.environmentName}
          label={`Avg ${time.environmentName} deploy`}
          value={formatDuration(time.averageSeconds)}
          hint={runCount(time)}
        />
      ))}
    </section>
  );
}

export function DeploymentTimeSummary({ times }: { times: PipelineDeploymentTime[] }) {
  return (
    <span className="flex flex-col gap-1 border-t pt-3 text-[13px]">
      {times.map(({ environmentName, averageSeconds }) => (
        <span className="flex items-center justify-between gap-3" key={environmentName}>
          <span className="truncate text-muted-foreground">Avg {environmentName} deploy</span>
          <span className="whitespace-nowrap font-medium">{formatDuration(averageSeconds)}</span>
        </span>
      ))}
    </span>
  );
}
