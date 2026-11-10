import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';

type ColorMode = 'light' | 'dark';

const DEFAULT_MODE: ColorMode = 'dark';
const subscribe = () => () => {};

/** The theme is only known in the browser, so the first render matches the server and the real mode follows. */
export const useColorMode = (): ColorMode => {
  const { resolvedTheme } = useTheme();
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return hydrated && resolvedTheme === 'light' ? 'light' : DEFAULT_MODE;
};
