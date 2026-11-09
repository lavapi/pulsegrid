import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  action,
  leading,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  leading?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center gap-4">
      {leading}
      <div className="min-w-0 flex-1 basis-60">
        <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </header>
  );
}
