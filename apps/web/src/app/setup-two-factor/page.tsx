import { redirect } from 'next/navigation';
import { AuthPage } from '@/components/auth/auth-page';
import { RequiredTwoFactor } from '@/components/auth/required-two-factor';
import { SetupSteps } from '@/components/setup/setup-steps';
import { getCurrentUser } from '@/lib/server-api';

export default async function SetupTwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ install?: string }>;
}) {
  const { install } = await searchParams;
  const user = await getCurrentUser();
  if (user.mustChangePassword) {
    redirect('/change-password');
  }
  if (user.twoFactorEnabled) {
    redirect('/');
  }
  return (
    <AuthPage
      steps={install ? <SetupSteps current={3} /> : undefined}
      title="Turn on two-factor authentication"
      description="Everyone needs this to protect your cloud keys and pipelines."
    >
      <RequiredTwoFactor next={install ? '/setup/integrations' : '/'} />
    </AuthPage>
  );
}
