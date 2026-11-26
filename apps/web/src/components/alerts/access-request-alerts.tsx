'use client';

import type { DatabaseAccessRequest, MyDatabaseAccess } from '@pulsegrid/shared';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import {
  decisionAlert,
  decisionToAnnounce,
  rememberIds,
  rememberedIds,
  requestsAlert,
  unseenRequests,
} from '@/lib/access-alerts';
import { apiSendForJson } from '@/lib/browser-api';
import { usePersonAlert } from './use-person-alert';

const APPROVER_EVERY_MS = 15_000;
const WAITING_EVERY_MS = 15_000;
const IDLE_EVERY_MS = 60_000;
const SEEN_KEY = 'pulsegrid.database-access.requests-seen';
const TOLD_KEY = 'pulsegrid.database-access.decisions-told';

/** Runs `check` now and again after the delay it returns; null stops it. */
function usePolling(check: () => Promise<number | null>) {
  const latest = useRef(check);
  latest.current = check;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const tick = async () => {
      const next = await latest.current();
      if (!stopped && next !== null) timer = setTimeout(() => void tick(), next);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
}

/** Approvers: an alert for each new request, even one that came in while the dashboard was closed. */
function ApproverAlerts() {
  const alert = usePersonAlert();
  const router = useRouter();
  const pathname = usePathname();
  const onPage = useRef(false);
  onPage.current = pathname.startsWith('/settings/database-access');

  usePolling(async () => {
    const { data } = await apiSendForJson<DatabaseAccessRequest[]>('/database-access/requests', 'GET');
    if (data) {
      const seen = rememberedIds(SEEN_KEY);
      const fresh = unseenRequests(data, seen);
      if (fresh.length > 0) {
        alert(requestsAlert(fresh));
        rememberIds(SEEN_KEY, [...seen, ...fresh.map(({ id }) => id)]);
        if (onPage.current) router.refresh();
      }
    }
    return APPROVER_EVERY_MS;
  });
  return null;
}

/** Everyone else: an alert when their own request is approved or declined. */
function RequesterAlerts() {
  const alert = usePersonAlert();
  const router = useRouter();
  const pathname = usePathname();
  const onPage = useRef(false);
  onPage.current = pathname.startsWith('/database-access');

  usePolling(async () => {
    const { data } = await apiSendForJson<MyDatabaseAccess>('/database-access/mine', 'GET');
    if (data && !data.ready) return null;
    const request = data?.request ?? null;
    const told = rememberedIds(TOLD_KEY);
    const decided = decisionToAnnounce(request, told, Date.now());
    if (decided) {
      alert(decisionAlert(decided));
      rememberIds(TOLD_KEY, [...told, decided.id]);
      if (onPage.current) router.refresh();
    }
    return request?.status === 'pending' ? WAITING_EVERY_MS : IDLE_EVERY_MS;
  });
  return null;
}

export function AccessRequestAlerts({ canApprove }: { canApprove: boolean }) {
  return canApprove ? <ApproverAlerts /> : <RequesterAlerts />;
}
