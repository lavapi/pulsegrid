import 'server-only';
import type { CurrentUser } from '@pulsegrid/shared';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

const apiUrl = (): string => process.env.API_URL ?? 'http://localhost:4000';

export const apiGet = async <T,>(path: string): Promise<T> => {
  const cookieHeader = (await cookies()).toString();
  const response = await fetch(`${apiUrl()}/api${path}`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });
  if (response.status === 401) {
    redirect('/login');
  }
  if (!response.ok) {
    throw new Error(`Request to ${path} failed with status ${response.status}`);
  }
  const body = await response.text();
  return (body ? JSON.parse(body) : null) as T;
};

export const apiGetOptional = async <T,>(path: string): Promise<T | null> => {
  const response = await fetch(`${apiUrl()}/api${path}`, { cache: 'no-store' });
  return response.ok ? ((await response.json()) as T) : null;
};

export const getCurrentUser = cache(() => apiGet<CurrentUser>('/me'));
