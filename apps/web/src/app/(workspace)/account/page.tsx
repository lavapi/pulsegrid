import type { AccountSettings } from '@pulsegrid/shared';
import { AccountSettingsPanel } from '@/components/auth/account-settings-panel';
import { PageHeader } from '@/components/ui/page-header';
import { apiGet } from '@/lib/server-api';

export default async function AccountPage() {
  const settings = await apiGet<AccountSettings>('/account');
  return (
    <>
      <PageHeader title="Your account" description={`${settings.displayName} · ${settings.email}`} />
      <AccountSettingsPanel settings={settings} />
    </>
  );
}
