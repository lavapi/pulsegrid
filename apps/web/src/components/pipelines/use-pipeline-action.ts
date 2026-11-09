'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { apiSend } from '@/lib/browser-api';

const REFRESH_DELAYS_MS = [0, 2_000, 6_000, 12_000];

export const usePipelineAction = () => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const send = (path: string, body: unknown, success: string) => {
    startTransition(async () => {
      const failure = await apiSend(path, 'POST', body);
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success(success);
      for (const delay of REFRESH_DELAYS_MS) {
        setTimeout(() => router.refresh(), delay);
      }
    });
  };

  return { pending, send };
};
