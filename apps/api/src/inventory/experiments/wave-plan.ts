import type { ExperimentRunItem, TouchedResource } from '@pulsegrid/shared';
import { keysClash } from './resource-keys';

/** After a test ends, its resources settle for this long before the next test on them may start. */
export const SETTLE_MS = 2 * 60_000;
/** A resource that isn't healthy this long after its test ended cancels the tests waiting for it. */
export const RECOVERY_TIMEOUT_MS = 30 * 60_000;

export const NOTES = {
  slot: 'Waiting for a slot.',
  zoneLast: 'Zone-wide test: runs alone after the others finish and recover.',
  zoneBusy: 'Waiting for the zone-wide test to finish and recover.',
  busy: (name: string) => `Waiting for the test on ${name} to finish.`,
  recovering: (name: string) => `Waiting for ${name} to recover.`,
  neverRecovered: (name: string) => `Cancelled: ${name} didn't recover within 30 minutes.`,
};

export interface RegionRoom {
  /** Tests this run may still start in the region: what's left of its wave and of AWS's quota. */
  slots: number;
  activeIds: ReadonlySet<string>;
}

export interface WavePlan {
  start: number[];
  notes: Map<number, string>;
  cancel: Map<number, string>;
}

type Hold = 'running' | 'recovering' | 'failed';

interface Lock {
  resource: TouchedResource;
  hold: Hold;
}

const isRunning = (item: ExperimentRunItem, rooms: ReadonlyMap<string, RegionRoom>): boolean =>
  item.experimentId !== null && (rooms.get(item.region)?.activeIds.has(item.experimentId) ?? false);

/** A started test that has ended but whose resources haven't been seen healthy yet. */
const isSettling = (item: ExperimentRunItem, rooms: ReadonlyMap<string, RegionRoom>): boolean =>
  item.experimentId !== null && !isRunning(item, rooms) && item.recovered !== true;

const holdOf = (item: ExperimentRunItem, rooms: ReadonlyMap<string, RegionRoom>): Hold | null => {
  if (isRunning(item, rooms)) {
    return 'running';
  }
  if (!isSettling(item, rooms)) {
    return null;
  }
  return item.recovered === false ? 'failed' : 'recovering';
};

const lockNote = ({ resource, hold }: Lock): string =>
  hold === 'running' ? NOTES.busy(resource.name) : NOTES.recovering(resource.name);

/**
 * Which waiting tests start now. Tests never overlap on a resource: a test waits while another test on the same
 * resource runs, and until that resource has recovered. Zone-wide tests run last, one at a time, alone.
 */
export const planWave = (items: readonly ExperimentRunItem[], rooms: ReadonlyMap<string, RegionRoom>): WavePlan => {
  const plan: WavePlan = { start: [], notes: new Map(), cancel: new Map() };
  const locks: Lock[] = items.flatMap((item) => {
    const hold = holdOf(item, rooms);
    return hold ? (item.resources ?? []).map((resource) => ({ resource, hold })) : [];
  });
  const busy = items.some((item) => holdOf(item, rooms) !== null);
  let zoneBusy = items.some((item) => item.zoneWide && holdOf(item, rooms) !== null);
  const othersLeft = items.some((item) => !item.zoneWide && (item.waiting || holdOf(item, rooms) !== null));
  const slots = new Map([...rooms].map(([region, room]) => [region, room.slots]));
  let startedHere = false;

  items.forEach((item, index) => {
    if (!item.waiting) {
      return;
    }
    if (item.zoneWide) {
      if (busy || othersLeft || zoneBusy || startedHere) {
        plan.notes.set(index, NOTES.zoneLast);
      } else if ((slots.get(item.region) ?? 0) > 0) {
        plan.start.push(index);
        zoneBusy = true;
        startedHere = true;
      } else {
        plan.notes.set(index, NOTES.slot);
      }
      return;
    }
    if (zoneBusy) {
      plan.notes.set(index, NOTES.zoneBusy);
      return;
    }
    const clash = locks.find((lock) =>
      (item.resources ?? []).some((resource) => keysClash(resource.key, lock.resource.key)),
    );
    if (clash?.hold === 'failed') {
      plan.cancel.set(index, NOTES.neverRecovered(clash.resource.name));
      return;
    }
    if (clash) {
      plan.notes.set(index, lockNote(clash));
      return;
    }
    const free = slots.get(item.region) ?? 0;
    if (free <= 0) {
      plan.notes.set(index, NOTES.slot);
      return;
    }
    plan.start.push(index);
    startedHere = true;
    slots.set(item.region, free - 1);
    locks.push(...(item.resources ?? []).map((resource) => ({ resource, hold: 'running' as const })));
  });
  return plan;
};

/** How many tests in a run share a resource with another test in it. */
export const sharingCount = (items: readonly Pick<ExperimentRunItem, 'resources' | 'zoneWide'>[]): number =>
  items.filter(
    (item, index) =>
      !item.zoneWide &&
      items.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          !other.zoneWide &&
          (item.resources ?? []).some((resource) =>
            (other.resources ?? []).some((otherResource) => keysClash(resource.key, otherResource.key)),
          ),
      ),
  ).length;
