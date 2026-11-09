import { useSyncExternalStore } from 'react';
import type { TimeMode } from './format';

const STORAGE_KEY = 'devdash-time-mode';
const DEFAULT_MODE: TimeMode = 'local';
const SERVER_MODE: TimeMode = 'utc';
const listeners = new Set<() => void>();

const readMode = (): TimeMode => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'utc' ? 'utc' : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
};

let current: TimeMode | null = null;

const snapshot = (): TimeMode => {
  current ??= readMode();
  return current;
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const setTimeMode = (mode: TimeMode): void => {
  current = mode;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    return;
  } finally {
    listeners.forEach((listener) => listener());
  }
};

export const useTimeMode = (): TimeMode => useSyncExternalStore(subscribe, snapshot, () => SERVER_MODE);
