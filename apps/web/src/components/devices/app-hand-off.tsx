'use client';

import { APP_URL_SCHEME, type DeviceSignInCode } from '@pulsegrid/shared';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiSendForJson } from '@/lib/browser-api';

/** Makes the one-time code and opens the app with it; the button is there if the browser doesn't switch. */
export function AppHandOff({ challenge, deviceName, state }: { challenge: string; deviceName: string; state: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data, error: failure } = await apiSendForJson<DeviceSignInCode>('/auth/device/codes', 'POST', {
        challenge,
        deviceName,
      });
      if (!data) {
        setError(failure ?? 'Signing in the app did not work. Try again from the app.');
        return;
      }
      const url = `${APP_URL_SCHEME}://signed-in?code=${encodeURIComponent(data.code)}&state=${encodeURIComponent(state)}`;
      setLink(url);
      window.location.assign(url);
    })();
  }, [challenge, deviceName, state]);

  if (error) {
    return (
      <p className="text-sm text-danger" role="alert">
        {error}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">{link ? 'Returning to the PulseGrid app…' : 'Signing in the app…'}</p>
      {link && (
        <Button asChild variant="primary" className="w-full">
          <a href={link}>Open the app</a>
        </Button>
      )}
    </div>
  );
}
