import type { Resource } from '@pulsegrid/shared';
import { Badge } from '@/components/ui/badge';
import { clusterRole } from '@/lib/cluster-role';

/** Writer or Reader, for a database in a cluster. */
export function RoleBadge({ resource }: { resource: Pick<Resource, 'details'> }) {
  const role = clusterRole(resource);
  return role && <Badge tone={role.tone}>{role.label}</Badge>;
}
