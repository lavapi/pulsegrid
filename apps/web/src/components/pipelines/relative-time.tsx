'use client';

import { formatRelativeTime } from '@/lib/format';

export function RelativeTime({ value }: { value: string | null }) {
  return (
    <time dateTime={value ?? undefined} suppressHydrationWarning>
      {formatRelativeTime(value, Date.now())}
    </time>
  );
}
