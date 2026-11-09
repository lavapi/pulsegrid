'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { apiSendForJson } from '@/lib/browser-api';

export const useAuthAction = () => {
  const [pending, startTransition] = useTransition();

  const post = <T,>(
    path: string,
    body: unknown,
    onSuccess: (data: T) => void,
    onError?: (message: string) => void,
  ) => {
    startTransition(async () => {
      const { data, error } = await apiSendForJson<T>(path, 'POST', body);
      if (error) {
        toast.error(error);
        onError?.(error);
        return;
      }
      onSuccess(data as T);
    });
  };

  return { pending, post };
};
