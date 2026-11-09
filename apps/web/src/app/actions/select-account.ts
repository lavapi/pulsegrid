'use server';

import { cookies } from 'next/headers';
import { selectedAccountCookie } from '@/lib/account-selection';
import { getCurrentUser } from '@/lib/server-api';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const selectAccount = async (accountId: string): Promise<void> => {
  if (!UUID_PATTERN.test(accountId)) {
    return;
  }
  const { tenant } = await getCurrentUser();
  if (!tenant) {
    return;
  }
  (await cookies()).set(selectedAccountCookie(tenant.id), accountId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
  });
};
