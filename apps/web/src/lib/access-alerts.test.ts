import type { DatabaseAccessRequest } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { decisionAlert, decisionToAnnounce, requestsAlert, unseenRequests } from './access-alerts';

const NOW = Date.parse('2026-11-26T12:00:00Z');

const request = (fields: Partial<DatabaseAccessRequest> = {}): DatabaseAccessRequest => ({
  id: 'r1',
  requestedBy: 'Vic',
  requestedByEmail: 'vic@example.test',
  userName: 'vic@example.test',
  hours: 2,
  reason: 'Check a stuck payout',
  status: 'pending',
  createdAt: '2026-11-26T11:00:00Z',
  expiresAt: '2026-11-27T11:00:00Z',
  decidedBy: null,
  decidedAt: null,
  declineReason: null,
  grantId: null,
  ...fields,
});

const approved = (fields: Partial<DatabaseAccessRequest> = {}) =>
  request({ status: 'approved', decidedBy: 'gus@example.test', decidedAt: '2026-11-26T11:55:00Z', ...fields });

describe('access request alerts', () => {
  it('alerts only for requests this browser has not seen', () => {
    const requests = [request(), request({ id: 'r2' })];
    expect(unseenRequests(requests, new Set(['r1'])).map(({ id }) => id)).toEqual(['r2']);
    expect(unseenRequests(requests, new Set(['r1', 'r2']))).toEqual([]);
  });

  it('names one request, and sums up several', () => {
    expect(requestsAlert([request()])).toEqual({
      title: 'Database access request',
      body: 'Vic asks for 2 hours: Check a stuck payout',
      href: '/settings/database-access',
      tag: 'database-access-request-r1',
    });
    expect(requestsAlert([request(), request({ id: 'r2' })]).body).toBe('2 people are waiting for database access.');
  });

  it('tells the requester once about a recent answer', () => {
    expect(decisionToAnnounce(approved(), new Set(), NOW)?.id).toBe('r1');
    expect(decisionToAnnounce(approved(), new Set(['r1']), NOW)).toBeNull();
    expect(decisionToAnnounce(approved({ decidedAt: '2026-11-25T11:00:00Z' }), new Set(), NOW)).toBeNull();
    expect(decisionToAnnounce(request(), new Set(), NOW)).toBeNull();
    expect(decisionToAnnounce(request({ status: 'cancelled', decidedAt: null }), new Set(), NOW)).toBeNull();
    expect(decisionToAnnounce(null, new Set(), NOW)).toBeNull();
  });

  it('says who answered, with the decline reason', () => {
    expect(decisionAlert(approved({ hours: 1 })).body).toBe(
      "gus@example.test approved 1 hour. Open Database access to connect once it's ready.",
    );
    expect(decisionAlert(approved({ status: 'declined', declineReason: 'Use staging' }))).toMatchObject({
      title: 'Database access declined',
      body: 'gus@example.test declined: Use staging',
      href: '/database-access',
    });
    expect(decisionAlert(approved({ status: 'declined' })).body).toBe('gus@example.test declined your request.');
  });
});
