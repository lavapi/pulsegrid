import { redirect } from 'next/navigation';
import { AuthPage } from '@/components/auth/auth-page';
import { TemporaryPasswordForm } from '@/components/auth/temporary-password-form';
import { getCurrentUser } from '@/lib/server-api';

export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user.mustChangePassword) {
    redirect('/');
  }
  return (
    <AuthPage
      title="Choose a new password"
      description="You signed in with a temporary password. Replace it to continue."
    >
      <TemporaryPasswordForm />
    </AuthPage>
  );
}
