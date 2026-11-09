'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const ACTIVE_INTERVAL_MS = 5_000;
const IDLE_INTERVAL_MS = 30_000;

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
