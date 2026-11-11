import Link from 'next/link';
import type { ResourceTab } from '@/lib/resource-logs';
import { cn } from '@/lib/utils';

export function ResourceTabs({ tabs, active, path }: { tabs: ResourceTab[]; active: string; path: string }) {
  return (
    <nav className="flex gap-1 border-b" aria-label="Resource sections">
      {tabs.map(({ id, label }) => (
        <Link
          key={id}
          href={id === 'overview' ? path : `${path}?tab=${id}`}
          aria-current={id === active ? 'page' : undefined}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-[13px] font-medium',
            id === active
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
