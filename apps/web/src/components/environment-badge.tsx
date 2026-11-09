import type { CloudAccount } from '@pulsegrid/shared';
import { Badge } from '@/components/ui/badge';
import { environmentLabel, environmentTone } from '@/lib/account-environment';

export function EnvironmentBadge({ account }: { account: CloudAccount }) {
  return <Badge tone={environmentTone(account)} className="shrink-0">{environmentLabel(account)}</Badge>;
}
