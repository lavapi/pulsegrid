'use client';

import { TriangleAlert } from 'lucide-react';
import { useProductionAccount } from '@/lib/production-account';

/**
 * Says what production a dialog changes: true means the selected production account, a string names it outright
 * (such as a production pipeline). Returns the name, or null when nothing in production is affected.
 */
export const useProductionTarget = (warn: boolean | string | undefined): string | null => {
  const account = useProductionAccount();
  if (typeof warn === 'string') {
    return warn;
  }
  return warn && account ? account.name : null;
};

/** A red box at the top of a dialog that changes something in production. */
export function ProductionNotice({ target }: { target: string | null }) {
  if (!target) {
    return null;
  }
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-production bg-danger-soft px-3 py-2.5 text-[13px] text-production"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        <strong>Production · {target}</strong>
        <span className="block text-foreground">This changes production.</span>
      </span>
    </p>
  );
}
