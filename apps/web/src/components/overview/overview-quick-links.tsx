import { type CloudAccount, type EnvironmentDomain, hasPermission } from '@pulsegrid/shared';
import Link from 'next/link';
import { QuickLinks } from '@/components/domain-links';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { apiGet, getCurrentUser } from '@/lib/server-api';

const SETTINGS_PATH = '/settings/environments';

export async function OverviewQuickLinks({ account }: { account: CloudAccount }) {
  if (!account.environmentId) {
    return null;
  }
  const [user, domains] = await Promise.all([
    getCurrentUser(),
    apiGet<EnvironmentDomain[]>(`/environments/${encodeURIComponent(account.environmentId)}/domains`),
  ]);
  const canManage = hasPermission(user, 'environments.manage');
  const environment = account.environmentName ?? 'this environment';

  if (domains.length > 0) {
    return (
      <QuickLinks
        domains={domains}
        description={environment}
        action={
          canManage && (
            <Link href={SETTINGS_PATH} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
              Edit links
            </Link>
          )
        }
      />
    );
  }
  if (!canManage) {
    return null;
  }
  return (
    <Card>
      <CardHeader
        title="Quick links"
        description={`Add the app and Grafana domains of ${environment} to open them from here.`}
        action={
          <Button asChild size="sm">
            <Link href={SETTINGS_PATH}>Add domains</Link>
          </Button>
        }
      />
    </Card>
  );
}
