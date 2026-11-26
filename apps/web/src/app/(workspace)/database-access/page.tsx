import { hasPermission, type MyDatabaseAccess } from '@pulsegrid/shared';
import { redirect } from 'next/navigation';
import { MyAccess } from '@/components/database-access/my-access';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { apiGet, getCurrentUser } from '@/lib/server-api';

const DESCRIPTION = 'Ask for read-only access to the production database for a set time.';

export default async function RequestDatabaseAccessPage() {
  const user = await getCurrentUser();
  if (hasPermission(user, 'production.database_access.grant')) {
    redirect('/settings/database-access');
  }
  const access = await apiGet<MyDatabaseAccess>('/database-access/mine');
  return (
    <>
      <PageHeader title="Database access" description={DESCRIPTION} />
      {access.ready ? (
        <MyAccess access={access} />
      ) : (
        <Card>
          <p className="p-5 text-sm text-muted-foreground">{access.message}</p>
        </Card>
      )}
    </>
  );
}
