'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { apiSend } from '@/lib/browser-api';

/** Sends the signed-in person a Slack message, to check they can be reached. */
export function TestMessageButton({ disabled }: { disabled?: boolean }) {
  const [pending, startTransition] = useTransition();

  const send = () => {
    startTransition(async () => {
      const failure = await apiSend('/notifications/me/test', 'POST');
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success('Test message sent. Check your Slack.');
    });
  };

  return (
    <Button size="sm" disabled={disabled || pending} onClick={send}>
      {pending ? 'Sending…' : 'Send me a test message'}
    </Button>
  );
}
