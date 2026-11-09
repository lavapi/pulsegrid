import type { HealthCounts, ResourceHealth } from '@pulsegrid/shared';
import { Badge } from '@/components/ui/badge';
import { healthLine, healthTone } from '@/lib/health';

const TONES = {
  healthy: 'success',
  degraded: 'danger',
  stopped: 'neutral',
  unknown: 'warning',
} as const;

export function HealthBadge({ health, status }: { health: ResourceHealth; status: string }) {
  return (
    <Badge tone={TONES[health]} dot>
      {status.toLowerCase()}
    </Badge>
  );
}

export function HealthSummaryBadge({ health }: { health: HealthCounts }) {
  return (
    <Badge tone={healthTone(health)} dot>
      {healthLine(health)}
    </Badge>
  );
}

export function HealthBar({ health }: { health: HealthCounts }) {
  const { healthy, degraded, stopped, unknown, total } = health;
  const segments = [
    { value: healthy, className: 'bg-success' },
    { value: unknown, className: 'bg-warning' },
    { value: stopped, className: 'bg-faint' },
    { value: degraded, className: 'bg-danger' },
  ];
  return (
    <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
      {total > 0 &&
        segments.map(
          ({ value, className }) =>
            value > 0 && (
              <i
                key={className}
                className={className}
                style={{ width: `${(value / total) * 100}%` }}
              />
            ),
        )}
    </div>
  );
}
