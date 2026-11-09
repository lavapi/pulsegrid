import type { EnvironmentDomain } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { domainHost, domainLinkLabel, domainName, domainsOfKind } from './domains';

const domain = (overrides: Partial<EnvironmentDomain>): EnvironmentDomain => ({
  id: 'd1',
  kind: 'app',
  label: null,
  url: 'https://staging.example.com',
  ...overrides,
});

describe('domains', () => {
  it('names a domain by its label', () => {
    expect(domainName(domain({ label: 'Website' }))).toBe('Website');
    expect(domainLinkLabel(domain({ label: 'Website' }))).toBe('Open Website');
  });

  it('falls back to the host for apps and to Grafana for Grafana', () => {
    expect(domainName(domain({ url: 'https://api.example.com/health' }))).toBe('api.example.com');
    expect(domainLinkLabel(domain({ kind: 'grafana', url: 'https://grafana.example.com' }))).toBe('Open Grafana');
  });

  it('shows the host with its port', () => {
    expect(domainHost(domain({ url: 'http://localhost:8080' }))).toBe('localhost:8080');
  });

  it('splits apps from Grafana', () => {
    const domains = [domain({ id: 'a' }), domain({ id: 'g', kind: 'grafana' }), domain({ id: 'b' })];
    expect(domainsOfKind(domains, 'app').map(({ id }) => id)).toEqual(['a', 'b']);
    expect(domainsOfKind(domains, 'grafana').map(({ id }) => id)).toEqual(['g']);
  });
});
