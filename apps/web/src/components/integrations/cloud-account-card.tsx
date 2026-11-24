import type { CloudAccount, ConnectionMethod, RoleTrustDetails } from '@pulsegrid/shared';
import {
  RemoveAccountButton,
  SyncNowButton,
  TestConnectionButton,
} from '@/components/account-actions';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { Time } from '@/components/ui/time';
import { replacementMethods, replacementText } from '@/lib/connection-methods';
import { WriteAccessWarning } from './credential-result';
import { EditAccountButton } from './edit-account-button';
import { ReplaceCredentialsButton } from './replace-credentials-button';
import { RoleTrustGuide } from './role-trust-guide';

const statusOf = ({ hasCredentials, status }: CloudAccount) => {
  if (!hasCredentials) {
    return { label: 'Needs credentials', tone: 'warning' } as const;
  }
  return status === 'connected'
    ? ({ label: 'Connected', tone: 'success' } as const)
    : ({ label: 'Connection failed', tone: 'danger' } as const);
};

interface CloudAccountCardProps {
  account: CloudAccount;
  methods: readonly ConnectionMethod[];
  trust: RoleTrustDetails | null;
  regions: readonly string[];
}

export function CloudAccountCard({ account, methods, trust, regions }: CloudAccountCardProps) {
  const { label, tone } = statusOf(account);
  const details = [account.accountId, account.credentialHint, account.regions.join(', ')].filter(
    Boolean,
  );
  return (
    <Card>
      <CardHeader
        title={account.name}
        description={details.join(' · ')}
        action={
          <Badge tone={tone} dot>
            {label}
          </Badge>
        }
      />
      <div className="flex flex-col gap-3 p-5">
        {account.lastError && (
          <p className="text-[13px] text-danger" role="alert">
            {account.lastError}
          </p>
        )}
        {account.canWrite && <WriteAccessWarning />}
        {account.lastSyncedAt && (
          <p className="text-[13px] text-muted-foreground">
            Last synced <Time value={account.lastSyncedAt} withZone />
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {account.hasCredentials && <TestConnectionButton accountId={account.id} />}
          {account.hasCredentials && account.status === 'connected' && (
            <SyncNowButton accountId={account.id} />
          )}
          {account.hasCredentials &&
            replacementMethods(account.credentialKind, methods).map((method) => (
              <ReplaceCredentialsButton
                key={method.id}
                path={`/cloud/accounts/${account.id}/credentials`}
                name={account.name}
                fields={method.fields}
                {...replacementText(account.credentialKind, method, account.name)}
                guide={method.id === 'role' && trust ? <RoleTrustGuide trust={trust} /> : undefined}
              />
            ))}
          <EditAccountButton account={account} regions={regions} />
          <RemoveAccountButton accountId={account.id} name={account.name} />
        </div>
      </div>
    </Card>
  );
}
