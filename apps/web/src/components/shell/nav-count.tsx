'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiSendForJson } from '@/lib/browser-api';

const REFRESH_MS = 60_000;

/** A number beside a menu entry, such as new urgent alerts, refreshed every minute and on each page change. */
export function NavCount({ path, collapsed }: { path: string; collapsed: boolean }) {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data } = await apiSendForJson<{ count: number }>(path, 'GET');
      if (active && data) setCount(data.count);
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [path, pathname]);

  if (count === 0) {
    return null;
  }
  const label = `${count} new`;
  return collapsed ? (
    <span className="absolute right-1 top-1 size-2 rounded-full bg-danger" aria-label={label} />
  ) : (
    <span className="ml-auto rounded-full bg-danger px-1.5 text-[11px] font-semibold leading-5 text-white" aria-label={label}>
      {count > 99 ? '99+' : count}
    </span>
  );
}
