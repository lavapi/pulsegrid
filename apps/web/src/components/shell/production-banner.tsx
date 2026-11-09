import type { CloudAccount } from '@pulsegrid/shared';
import { TriangleAlert } from 'lucide-react';

export function ProductionBanner({ account }: { account: CloudAccount }) {
  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex h-8 items-center justify-center gap-2 bg-production px-4 text-[13px] font-semibold text-white"
    >
      <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
      <span className="truncate">
        PRODUCTION · {account.name} ({account.accountId})
      </span>
    </div>
  );
}
