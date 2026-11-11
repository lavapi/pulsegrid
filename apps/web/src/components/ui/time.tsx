'use client';

import { formatPreciseTime, formatTime, type TimeMode, zoneLabel } from '@/lib/format';
import { useTimeMode } from '@/lib/time-mode';

const OTHER_MODE: Record<TimeMode, TimeMode> = { utc: 'local', local: 'utc' };

export function Time({
  value,
  withZone = false,
  seconds = false,
}: {
  value: string;
  withZone?: boolean;
  /** Down to the second, for log lines. */
  seconds?: boolean;
}) {
  const mode = useTimeMode();
  const other = OTHER_MODE[mode];
  const format = seconds ? formatPreciseTime : formatTime;
  return (
    <time dateTime={value} title={`${format(value, other)} ${zoneLabel(other)}`} suppressHydrationWarning>
      {format(value, mode)}
      {withZone && ` ${zoneLabel(mode)}`}
    </time>
  );
}
