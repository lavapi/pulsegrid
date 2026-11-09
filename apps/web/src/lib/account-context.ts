import 'server-only';
import type { CloudAccount } from '@pulsegrid/shared';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { pickAccount, selectableAccounts, selectedAccountCookie } from './account-selection';
import { apiGet, getCurrentUser } from './server-api';

export interface AccountContext {
  accounts: CloudAccount[];
  selected: CloudAccount | null;
}

export const getAccountContext = cache(async (): Promise<AccountContext> => {
  const [visible, cookieStore, user] = await Promise.all([
    apiGet<CloudAccount[]>('/cloud/accounts'),
    cookies(),
    getCurrentUser(),
  ]);
  const cookieName = selectedAccountCookie(user.tenant?.id ?? '');
  const accounts = selectableAccounts(visible);
  return {
    accounts,
    selected: pickAccount(accounts, cookieStore.get(cookieName)?.value),
  };
});
