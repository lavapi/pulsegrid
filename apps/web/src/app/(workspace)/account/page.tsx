import type { AccountSettings, MyNotifications } from '@pulsegrid/shared';
import { AccountSettingsPanel } from '@/components/auth/account-settings-panel';
import { MyNotificationsCard } from '@/components/notifications/my-notifications-card';
import { PageHeader } from '@/components/ui/page-header';
import { apiGet } from '@/lib/server-api';

export default async function AccountPage() {
  const [settings, notifications] = await Promise.all([
    apiGet<AccountSettings>('/account'),
    apiGet<MyNotifications>('/notifications/me'),
  ]);
  return (
    <>
      <PageHeader title="Your account" description={`${settings.displayName} · ${settings.email}`} />
      <AccountSettingsPanel settings={settings} />
      <MyNotificationsCard settings={notifications} />
    </>
  );
}
