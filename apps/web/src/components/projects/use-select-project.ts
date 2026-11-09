'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { apiSend } from '@/lib/browser-api';

export const useSelectProject = () => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const select = (id: string) => {
    startTransition(async () => {
      const failure = await apiSend(`/projects/${id}/select`, 'POST');
      if (failure) {
        toast.error(failure);
        return;
      }
      router.push('/');
      router.refresh();
    });
  };

  return { pending, select };
};
