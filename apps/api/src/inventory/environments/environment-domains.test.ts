import { describe, expect, it } from 'vitest';
import { normalizeDomainUrl } from './environment-domains';

describe('normalizeDomainUrl', () => {
  it('adds https and drops a bare trailing slash', () => {
    expect(normalizeDomainUrl(' staging.example.com ')).toBe('https://staging.example.com');
    expect(normalizeDomainUrl('https://grafana.example.com/')).toBe('https://grafana.example.com');
  });

  it('keeps http, ports and paths', () => {
    expect(normalizeDomainUrl('http://grafana.internal.example.com:3000')).toBe('http://grafana.internal.example.com:3000');
    expect(normalizeDomainUrl('example.com/app?tab=1')).toBe('https://example.com/app?tab=1');
    expect(normalizeDomainUrl('localhost:8080')).toBe('https://localhost:8080');
  });

  it('refuses anything that is not a web address', () => {
    for (const input of ['', 'not a domain', 'intranet', 'ftp://example.com', 'https://user:pw@example.com', 'javascript:alert(1)']) {
      expect(normalizeDomainUrl(input)).toBeNull();
    }
    expect(normalizeDomainUrl(`example.com/${'a'.repeat(300)}`)).toBeNull();
  });
});
