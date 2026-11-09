import type { AuditEvent } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { activityDetails, activityLabel } from './activity-events';

const event = (action: string, metadata: Record<string, unknown>) =>
  ({ action, metadata }) as AuditEvent;

describe('activity events', () => {
  it('uses a readable label, and falls back to the action', () => {
    expect(activityLabel(event('secret.key_deleted', {}))).toBe('Secret key deleted');
    expect(activityLabel(event('something.new', {}))).toBe('something.new');
  });

  it('shows the resource', () => {
    expect(activityDetails(event('cloud.action.started', { label: 'db-1' }))).toBe('db-1');
  });

  it('shows the key of a secret', () => {
    expect(activityDetails(event('secret.key_saved', { label: 'app', key: 'TOKEN' }))).toBe('app: TOKEN');
  });

  it('shows a rename', () => {
    const metadata = { label: 'app', key: 'NEW', previousKey: 'OLD' };
    expect(activityDetails(event('secret.key_saved', metadata))).toBe('app: OLD renamed to NEW');
  });

  it('lists the keys of a full replace', () => {
    const metadata = { label: 'app', added: ['A'], changed: ['B', 'C'], removed: [] };
    expect(activityDetails(event('secret.key_saved', metadata))).toBe('app: added A, changed B, C');
  });
});
