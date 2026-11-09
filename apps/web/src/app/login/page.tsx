import { type AuthMethods, signInErrorMessage } from '@pulsegrid/shared';
import { redirect } from 'next/navigation';
import { AuthPage } from '@/components/auth/auth-page';
import { SignInForm } from '@/components/auth/sign-in-form';
import { apiGet } from '@/lib/server-api';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; challenge?: string }>;
}) {
  const { error, challenge } = await searchParams;
  const { google, setupRequired } = await apiGet<AuthMethods>('/auth/methods');
  if (setupRequired) {
    redirect('/setup');
  }
  const message = signInErrorMessage(error);

  return (
    <AuthPage
      title="Sign in to PulseGrid"
      footer="Lost your password? Ask your super admin."
    >
      {message && (
        <p className="rounded-lg bg-danger-soft px-3 py-2.5 text-[13px] text-danger" role="alert">
          {message}
        </p>
      )}
      <SignInForm google={google} initialChallenge={challenge ?? null} />
    </AuthPage>
  );
}
