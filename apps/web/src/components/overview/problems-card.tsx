import { type Resource, resourcePath, resourceTypeLabel, shownName } from '@pulsegrid/shared';
import Link from 'next/link';
import { HealthBadge } from '@/components/health-badge';
import { Card, CardHeader } from '@/components/ui/card';

export function ProblemsCard({ resources }: { resources: Resource[] }) {
  return (
    <Card>
      <CardHeader title="Problems" description="Resources that need attention" />
      <ul className="divide-y">
        {resources.map((resource) => (
          <li key={resource.id}>
            <Link
              href={resourcePath(resource)}
              className="flex items-center justify-between gap-3 px-5 py-2.5 transition-colors hover:bg-muted"
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">{shownName(resource)}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {resourceTypeLabel(resource.type)}
                  {resource.displayName && ` · ${resource.name}`}
                </span>
              </span>
              <HealthBadge health={resource.health} status={resource.status} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
