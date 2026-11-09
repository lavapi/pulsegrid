'use client';

import { TwoFactorSetup } from './two-factor-setup';

export function RequiredTwoFactor({ next }: { next: string }) {
  return <TwoFactorSetup onFinished={() => window.location.assign(next)} />;
}
