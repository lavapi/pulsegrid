import type { ServiceCategorySummary } from '@pulsegrid/shared';
import { ServiceCard } from '@/components/service-card';

export function ServiceGrid({
  categories,
  hrefFor,
}: {
  categories: ServiceCategorySummary[];
  hrefFor: (summary: ServiceCategorySummary) => string;
}) {
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-3.5 md:grid-cols-2 xl:grid-cols-3" aria-label="AWS services">
      {categories.map((summary) => (
        <ServiceCard summary={summary} href={hrefFor(summary)} key={summary.category} />
      ))}
    </section>
  );
}
