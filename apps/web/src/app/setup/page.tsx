import type { AuthMethods } from '@pulsegrid/shared';
import { redirect } from 'next/navigation';
import { SetupWizard } from '@/components/setup/setup-wizard';
import { apiGet } from '@/lib/server-api';

export default async function SetupPage() {
  const { setupRequired } = await apiGet<AuthMethods>('/auth/methods');
  if (!setupRequired) {
    redirect('/login');
  }
  return <SetupWizard />;
}
