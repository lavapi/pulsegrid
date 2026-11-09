import type { Release, ReleaseState } from '@pulsegrid/shared';
import { isActiveRelease } from '@pulsegrid/shared';

type Tone = 'success' | 'danger' | 'neutral' | 'primary' | 'warning';

export const RELEASE_STATES: Record<ReleaseState, { label: string; tone: Tone }> = {
  idle: { label: 'Not run yet', tone: 'neutral' },
  building: { label: 'Building', tone: 'primary' },
  deploying: { label: 'Deploying', tone: 'primary' },
  ready: { label: 'Ready for testing', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  not_deployed: { label: 'Not deployed', tone: 'warning' },
};

export const releaseCounts = (releases: readonly Release[]) => ({
  inProgress: releases.filter(({ state }) => isActiveRelease(state)).length,
  ready: releases.filter(({ state }) => state === 'ready').length,
  failed: releases.filter(({ state }) => state === 'failed').length,
});

export const encodeChoice = (...parts: string[]): string => JSON.stringify(parts);

export const decodeChoice = (value: string): string[] => JSON.parse(value) as string[];
