import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';

export function AuthPage({
  title,
  description,
  children,
  footer,
  steps,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  steps?: ReactNode;
}) {
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        {steps}
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid size-11 place-items-center rounded-xl bg-primary text-lg font-semibold text-primary-foreground">
            D
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
        </div>
        <Card className="flex flex-col gap-4 p-5">{children}</Card>
        {footer && <p className="text-center text-[13px] text-muted-foreground">{footer}</p>}
      </div>
    </main>
  );
}
