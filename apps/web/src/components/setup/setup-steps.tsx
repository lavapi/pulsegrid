import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const STEPS = ['Setup code', 'Project', 'Super admin', 'Two-factor', 'Integrations'];

export function SetupSteps({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs" aria-label="Setup steps">
      {STEPS.map((step, index) => (
        <li
          key={step}
          aria-current={index === current ? 'step' : undefined}
          className={cn(
            'flex items-center gap-1.5',
            index === current ? 'font-medium text-foreground' : 'text-muted-foreground',
          )}
        >
          {index < current ? (
            <Check className="size-3.5 text-success" aria-hidden="true" />
          ) : (
            <span aria-hidden="true">{index + 1}</span>
          )}
          {step}
        </li>
      ))}
    </ol>
  );
}
