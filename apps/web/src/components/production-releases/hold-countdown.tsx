'use client';

import { useEffect, useState } from 'react';
import { timeLeft } from '@/lib/production-releases';

const TICK_MS = 15_000;

/** The time left until the release rolls back by itself, counting down while the page is open. */
export function HoldCountdown({ until }: { until: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const left = timeLeft(until, now);
  return <span className="font-semibold tabular-nums">{left ? `Rolls back by itself in ${left}` : 'Rolling back by itself now'}</span>;
}
