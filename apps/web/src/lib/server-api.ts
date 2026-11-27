import 'server-only';
import type { CurrentUser } from '@pulsegrid/shared';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

const apiUrl = (): string => process.env.API_URL ?? 'http://localhost:4000';

/** Signed out: off to sign-in, coming back to `next` afterwards when a page needs to. */
const request = async (path: string, next?: string): Promise<Response> => {
  const response = await fetch(`${apiUrl()}/api${path}`, {
    headers: { cookie: (await cookies()).toString() },
    cache: 'no-store',
  });
  if (response.status === 401) {
    redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
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

/** The signed-in person, sending anyone signed out to sign in and back to `next`. */
export const getCurrentUserReturningTo = async (next: string): Promise<CurrentUser> => {
  const response = await request('/me', next);
  if (!response.ok) {
    throw new Error(`Request to /me failed with status ${response.status}`);
  }
  return parsed<CurrentUser>(response);
};
