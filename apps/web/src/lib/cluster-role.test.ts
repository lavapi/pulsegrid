import { describe, expect, it } from 'vitest';
import { clusterRole, formatRole } from './cluster-role';

describe('clusterRole', () => {
  it('names writers and readers, and nothing outside a cluster', () => {
    expect(clusterRole({ details: { role: 'writer' } })).toEqual({ label: 'Writer', tone: 'primary' });
    expect(clusterRole({ details: { role: 'reader' } })).toEqual({ label: 'Reader', tone: 'neutral' });
    expect(clusterRole({ details: {} })).toBeNull();
    expect(formatRole('reader')).toBe('Reader');
  });
});
