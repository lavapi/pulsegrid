'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const ACTIVE_INTERVAL_MS = 5_000;
const IDLE_INTERVAL_MS = 30_000;

/** Reloads the page's data while it is visible: every 5 seconds while something runs, every 30 otherwise. */
export function LiveRefresh({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(
      () => {
        if (document.visibilityState === 'visible') {
          router.refresh();
        }
      },
      active ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [active, router]);

  return null;
}
