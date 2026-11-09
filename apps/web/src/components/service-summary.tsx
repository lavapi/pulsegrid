import type { HealthCounts } from '@pulsegrid/shared';
import { StatTile } from '@/components/ui/stat-tile';

export function HealthTiles({ health, serviceCount }: { health: HealthCounts; serviceCount?: number }) {
  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Health summary">
      <StatTile label="Resources" value={health.total} />
      <StatTile label="Healthy" value={health.healthy} tone={health.healthy > 0 ? 'success' : 'default'} />
      <StatTile label="Need attention" value={health.degraded} tone={health.degraded > 0 ? 'danger' : 'default'} />
      {serviceCount === undefined ? (
        <StatTile label="Stopped" value={health.stopped} />
      ) : (
        <StatTile label="Services" value={serviceCount} />
      )}
    </section>
  );
}
