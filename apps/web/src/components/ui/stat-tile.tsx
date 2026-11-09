import { cn } from '@/lib/utils';

const TONES = {
  default: '',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
} as const;

export function StatTile({
  label,
  value,
  tone = 'default',
  compact = false,
  hint,
}: {
  label: string;
  value: number | string;
  tone?: keyof typeof TONES;
  compact?: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3.5">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <strong
        className={cn(
          'mt-0.5 block font-semibold tracking-tight',
          compact ? 'truncate text-[15px] leading-8' : 'text-2xl',
          TONES[tone],
        )}
        title={compact ? String(value) : undefined}
      >
        {value}
      </strong>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}
