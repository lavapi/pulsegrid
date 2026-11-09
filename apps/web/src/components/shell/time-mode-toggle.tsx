'use client';

import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { zoneLabel } from '@/lib/format';
import { setTimeMode, useTimeMode } from '@/lib/time-mode';

export function TimeModeToggle() {
  const mode = useTimeMode();
  return (
    <Button
      variant="ghost"
      size="sm"
      suppressHydrationWarning
      aria-label={`Times are in ${zoneLabel(mode)}. Switch time zone`}
      onClick={() => setTimeMode(mode === 'utc' ? 'local' : 'utc')}
    >
      <Clock />
      <span className="max-sm:hidden" suppressHydrationWarning>
        {zoneLabel(mode)}
      </span>
    </Button>
  );
}
