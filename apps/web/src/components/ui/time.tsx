'use client';

import { formatTime, type TimeMode, zoneLabel } from '@/lib/format';
import { useTimeMode } from '@/lib/time-mode';

const OTHER_MODE: Record<TimeMode, TimeMode> = { utc: 'local', local: 'utc' };

export function Time({ value, withZone = false }: { value: string; withZone?: boolean }) {
  const mode = useTimeMode();
  const other = OTHER_MODE[mode];
  return (
    <time dateTime={value} title={`${formatTime(value, other)} ${zoneLabel(other)}`} suppressHydrationWarning>
      {formatTime(value, mode)}
      {withZone && ` ${zoneLabel(mode)}`}
    </time>
  );
}
