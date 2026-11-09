import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card } from './card';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </Card>
  );
}
