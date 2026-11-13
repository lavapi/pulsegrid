import { type DatabaseAccessGrant, type DatabaseAccessView, hasPermission } from '@pulsegrid/shared';
import { redirect } from 'next/navigation';
import { GrantForm } from '@/components/database-access/grant-form';
import { GrantHistory } from '@/components/database-access/grant-history';
import { GrantList } from '@/components/database-access/grant-list';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { apiGet, getCurrentUser } from '@/lib/server-api';

const SETTING = /^DB_ACCESS_[A-Z_]+$/;
const DESCRIPTION =
  'Give a person read-only access to the production database for a set time. Every change asks for your code again.';

export default async function DatabaseAccessPage() {
  const user = await getCurrentUser();
  if (!hasPermission(user, 'production.database_access.grant')) {
    redirect('/');
  }
  const view = await apiGet<DatabaseAccessView>('/database-access');
  if (!view.ready) {
    return (
      <>
        <PageHeader title="Database access" description={DESCRIPTION} />
        <Card>
          <div className="flex flex-col gap-2 p-5 text-sm">
            <p>Database access isn&apos;t set up for this project yet.</p>
            <ul className="list-disc pl-5 text-[13px] text-muted-foreground">
              {view.problems.map((problem) => (
                <li key={problem}>{SETTING.test(problem) ? <code>{problem}</code> : problem}</li>
              ))}
            </ul>
            <p className="text-[13px] text-muted-foreground">See docs/database-access.md for the settings.</p>
          </div>
        </Card>
      </>
    );
  }
  const history = await apiGet<DatabaseAccessGrant[]>('/database-access/history');
  return (
    <>
      <PageHeader title="Database access" description={DESCRIPTION} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <GrantForm maxHours={view.maxHours} />
        <GrantList
          grants={view.grants}
          maxHours={view.maxHours}
          connect={view.connect}
          outside={view.outside}
          outsideCheckedAt={view.outsideCheckedAt}
        />
      </div>
      {view.missingConnect.length > 0 && (
        <p className="text-[13px] text-muted-foreground">
          Connect steps appear once these are set: {view.missingConnect.join(', ')}.
        </p>
      )}
      <GrantHistory grants={history} />
    </>
  );
}
