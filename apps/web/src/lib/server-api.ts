import 'server-only';
import type { CurrentUser } from '@pulsegrid/shared';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

const apiUrl = (): string => process.env.API_URL ?? 'http://localhost:4000';

const request = async (path: string): Promise<Response> => {
  const response = await fetch(`${apiUrl()}/api${path}`, {
    headers: { cookie: (await cookies()).toString() },
    cache: 'no-store',
  });
  if (response.status === 401) {
    redirect('/login');
  }
  return response;
};

const parsed = async <T,>(response: Response): Promise<T> => {
  const body = await response.text();
  return (body ? JSON.parse(body) : null) as T;
};

export const apiGet = async <T,>(path: string): Promise<T> => {
  const response = await request(path);
  if (!response.ok) {
    throw new Error(`Request to ${path} failed with status ${response.status}`);
  }
  return parsed<T>(response);
};

/** For extras a page can do without: any failure other than a signed-out session gives null. */
export const apiGetOptional = async <T,>(path: string): Promise<T | null> => {
  const response = await request(path);
  return response.ok ? parsed<T>(response) : null;
};

export const getCurrentUser = cache(() => apiGet<CurrentUser>('/me'));
