'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

export const useUrlFilters = () => {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const change = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    next.delete('cursor');
    if (value) {
      next.set(name, value);
    } else {
      next.delete(name);
    }
    startTransition(() => router.replace(`${pathname}?${next}`));
  };

  return { value: (name: string) => params.get(name) ?? '', change };
};
