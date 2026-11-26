'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type Permission = NotificationPermission | 'unsupported';

const current = (): Permission => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

/** Asks the browser for notifications; browsers only ask after a click, so this is a button. */
export function BrowserNotificationsButton() {
  const [permission, setPermission] = useState<Permission>('unsupported');
  useEffect(() => setPermission(current()), []);

  if (permission === 'granted' || permission === 'unsupported') return null;
  if (permission === 'denied') {
    return (
      <p className="text-[13px] text-muted-foreground">
        Browser notifications are blocked for this site. Allow them in your browser&apos;s site settings.
      </p>
    );
  }
  return (
    <Button
      size="sm"
      onClick={async () => setPermission(await Notification.requestPermission().catch(() => current()))}
    >
      Turn on browser notifications
    </Button>
  );
}
