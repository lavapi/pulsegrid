import type { AccountSettings, SignedInDevice } from '@pulsegrid/shared';
import { AccountSettingsPanel } from '@/components/auth/account-settings-panel';
import { DevicesCard } from '@/components/devices/devices-card';
import { PageHeader } from '@/components/ui/page-header';
import { apiGet } from '@/lib/server-api';

export default async function AccountPage() {
  const [settings, devices] = await Promise.all([
    apiGet<AccountSettings>('/account'),
    apiGet<SignedInDevice[]>('/account/devices'),
  ]);
  return (
    <>
      <PageHeader title="Your account" description={`${settings.displayName} · ${settings.email}`} />
      <AccountSettingsPanel settings={settings} />
      <DevicesCard devices={devices} />
    </>
  );
}
