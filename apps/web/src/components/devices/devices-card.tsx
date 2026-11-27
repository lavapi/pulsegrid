'use client';

import type { SignedInDevice } from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { Time } from '@/components/ui/time';
import { apiSend } from '@/lib/browser-api';

function SignOutButton({ device }: { device: SignedInDevice }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const signOut = () =>
    startTransition(async () => {
      const failure = await apiSend(`/account/devices/${device.id}`, 'DELETE');
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success(`${device.name} is signed out`);
      router.refresh();
    });
  return (
    <ConfirmButton
      label="Sign out"
      title={`Sign out ${device.name}?`}
      description="The app on that phone signs out and stops getting notifications."
      confirmLabel="Sign out"
      disabled={pending}
      onConfirm={signOut}
    />
  );
}

/** Phones signed in to the iPhone app, each signed in for 30 days from its last use. */
export function DevicesCard({ devices }: { devices: SignedInDevice[] }) {
  return (
    <Card>
      <CardHeader title="Devices" description="Phones signed in to the PulseGrid iPhone app" />
      {devices.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">No phones are signed in.</p>
      ) : (
        <ul className="divide-y">
          {devices.map((device) => (
            <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-[13px]">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{device.name}</span>
                <span className="text-muted-foreground">
                  Signed in <Time value={device.signedInAt} withZone />
                  {device.lastUsedAt && (
                    <>
                      {' '}
                      · last used <Time value={device.lastUsedAt} withZone />
                    </>
                  )}
                </span>
              </div>
              <SignOutButton device={device} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
