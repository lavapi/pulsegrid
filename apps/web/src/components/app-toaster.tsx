'use client';

import { useTheme } from 'next-themes';
import { Toaster } from 'sonner';

export function AppToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme === 'light' ? 'light' : 'dark'}
      position="bottom-right"
      richColors
      closeButton
    />
  );
}
