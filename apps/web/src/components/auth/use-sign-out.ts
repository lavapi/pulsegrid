'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { apiSend } from '@/lib/browser-api';

export const useSignOut = () => {
  const router = useRouter();
  return async () => {
    const failure = await apiSend('/auth/logout', 'POST');
    if (failure) {
      toast.error(failure);
      return;
    }
    router.push('/login');
    router.refresh();
  };
};
