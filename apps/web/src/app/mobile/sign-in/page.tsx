import { AppHandOff } from '@/components/devices/app-hand-off';
import { AuthPage } from '@/components/auth/auth-page';
import { getCurrentUserReturningTo } from '@/lib/server-api';

const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const STATE = /^[A-Za-z0-9_-]{16,64}$/;

/** The iPhone app opens this in the system browser: sign in as usual, then it hands the sign-in to the app. */
export default async function MobileSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ challenge?: string; state?: string; device?: string }>;
}) {
  const { challenge = '', state = '', device = '' } = await searchParams;
  const deviceName = device.trim().slice(0, 60) || 'iPhone';
  if (!CHALLENGE.test(challenge) || !STATE.test(state)) {
    return (
      <AuthPage title="Sign in to the app">
        <p className="text-sm text-muted-foreground">Open this from the PulseGrid app on your iPhone.</p>
      </AuthPage>
    );
  }
  const here = `/mobile/sign-in?${new URLSearchParams({ challenge, state, device: deviceName }).toString()}`;
  const user = await getCurrentUserReturningTo(here);
  if (user.mustChangePassword || !user.twoFactorEnabled) {
    return (
      <AuthPage title="Sign in to the app">
        <p className="text-sm text-muted-foreground">
          Finish setting up your account on the PulseGrid website first, then sign in from the app again.
        </p>
      </AuthPage>
    );
  }
  return (
    <AuthPage title="Sign in to the app" description={`Signing in ${deviceName} as ${user.email}`}>
      <AppHandOff challenge={challenge} deviceName={deviceName} state={state} />
    </AuthPage>
  );
}
