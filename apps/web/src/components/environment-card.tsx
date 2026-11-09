import { CLOUD_SERVICES, type EnvironmentSummary } from '@pulsegrid/shared';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { HealthBar, HealthSummaryBadge } from '@/components/health-badge';

export function EnvironmentCard({ environment }: { environment: EnvironmentSummary }) {
  return (
    <Link
      href={`/environments/${environment.id}`}
      className="group flex flex-col gap-3.5 rounded-xl border bg-card p-[18px] transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-[0_0_0_4px_var(--ring)]"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold">{environment.name}</h2>
          <p className="truncate text-[13px] text-muted-foreground">
            {environment.accounts.map((account) => account.name).join(', ')}
          </p>
        </div>
        <ArrowRight
          className="size-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
          aria-hidden="true"
        />
      </div>
      <div className="flex items-baseline gap-2">
        <strong className="text-2xl font-semibold tracking-tight">{environment.health.total}</strong>
        <span className="text-[13px] text-muted-foreground">resources</span>
      </div>
      <HealthBar health={environment.health} />
      <div>
        <HealthSummaryBadge health={environment.health} />
      </div>
      <dl className="grid grid-cols-2 gap-x-5 gap-y-1 border-t pt-3 text-[13px]">
        {environment.services.map(({ service, health }) => (
          <div className="flex justify-between gap-2" key={service}>
            <dt className="text-muted-foreground">{CLOUD_SERVICES[service]}</dt>
            <dd className={health.degraded > 0 ? 'font-medium text-danger' : ''}>
              {health.degraded > 0 ? `${health.degraded} of ${health.total}` : health.total}
            </dd>
          </div>
        ))}
      </dl>
    </Link>
  );
}
