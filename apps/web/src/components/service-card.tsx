import { SERVICE_CATEGORIES, type ServiceCategorySummary } from '@pulsegrid/shared';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { HealthBar, HealthSummaryBadge } from '@/components/health-badge';
import { ServiceIcon } from '@/components/service-icon';
import { categoryTitle, countSummary } from '@/lib/service-views';

export function ServiceCard({
  summary,
  href,
}: {
  summary: ServiceCategorySummary;
  href: string;
}) {
  const { category, health } = summary;
  return (
    <Link
      href={href}
      className="group flex flex-col gap-3.5 rounded-xl border bg-card p-[18px] transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-[0_0_0_4px_var(--ring)]"
    >
      <div className="flex items-center gap-3">
        <ServiceIcon category={category} size={40} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold">{categoryTitle(summary)}</h2>
          <p className="truncate text-[13px] text-muted-foreground">
            {SERVICE_CATEGORIES[category].description}
          </p>
        </div>
        <ArrowRight
          className="size-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
          aria-hidden="true"
        />
      </div>
      <div className="flex items-baseline gap-2.5">
        <strong className="text-2xl font-semibold tracking-tight">{health.total}</strong>
        <span className="truncate text-[13px] text-muted-foreground">{countSummary(summary)}</span>
      </div>
      <HealthBar health={health} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <HealthSummaryBadge health={health} />
      </div>
    </Link>
  );
}
