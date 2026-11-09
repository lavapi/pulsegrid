import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const FIELD =
  'h-9 w-full rounded-lg border bg-card px-3 text-sm text-foreground transition-colors placeholder:text-faint focus:border-primary focus:outline-none focus:ring-4 focus:ring-ring disabled:opacity-50';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(FIELD, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(FIELD, 'h-auto py-2', className)} {...props} />;
}

export function Field({
  label,
  hint,
  children,
  className,
  labelsOwnControl = false,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
  labelsOwnControl?: boolean;
}) {
  const Wrapper = labelsOwnControl ? 'div' : 'label';
  return (
    <Wrapper className={cn('flex min-w-0 flex-col gap-1.5 text-[13px] font-medium', className)}>
      <span>{label}</span>
      {children}
      {hint && <span className="font-normal text-muted-foreground">{hint}</span>}
    </Wrapper>
  );
}
