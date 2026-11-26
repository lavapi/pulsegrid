'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { toast } from 'sonner';
import type { PersonAlert } from '@/lib/access-alerts';
import { playChime } from '@/lib/chime';

const canNotify = (): boolean => typeof Notification !== 'undefined' && Notification.permission === 'granted';

/** Tells the person something needs them: a chime, a toast, and a browser notification when they allowed it. */
export function usePersonAlert(): (alert: PersonAlert) => void {
  const router = useRouter();
  return useCallback(
    ({ title, body, href, tag }: PersonAlert) => {
      playChime();
      toast(title, { description: body, duration: 15_000, action: { label: 'Open', onClick: () => router.push(href) } });
      if (!canNotify()) return;
      try {
        const notification = new Notification(title, { body, tag, icon: '/favicon.ico' });
        notification.onclick = () => {
          window.focus();
          router.push(href);
          notification.close();
        };
      } catch {
        // Some browsers only notify from a service worker; the toast still shows.
      }
    },
    [router],
  );
}
