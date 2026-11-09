'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

export const useRefreshingAction = () => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (request: () => Promise<string | null>, success: string, onSuccess?: () => void) => {
    startTransition(async () => {
      const failure = await request();
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success(success);
      onSuccess?.();
      router.refresh();
    });
  };

  return { pending, run };
};
