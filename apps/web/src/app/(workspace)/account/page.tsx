import type { AccountSettings, NotificationSettings, SignedInDevice } from '@pulsegrid/shared';
import { AccountSettingsPanel } from '@/components/auth/account-settings-panel';
import { DevicesCard } from '@/components/devices/devices-card';
import { NotificationsCard } from '@/components/notifications/notifications-card';
import { PageHeader } from '@/components/ui/page-header';
import { apiGet } from '@/lib/server-api';

export default async function AccountPage() {
  const [settings, devices, notifications] = await Promise.all([
    apiGet<AccountSettings>('/account'),
    apiGet<SignedInDevice[]>('/account/devices'),
    apiGet<NotificationSettings>('/account/notifications'),
  ]);
  return (
    <>
      <PageHeader title="Your account" description={`${settings.displayName} · ${settings.email}`} />
      <AccountSettingsPanel settings={settings} />
      <DevicesCard devices={devices} />
      <NotificationsCard initial={notifications} />
    </>
  );
}
