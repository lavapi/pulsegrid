import { describe, expect, it } from 'vitest';
import { parseAccessLine, parseConnectionLine, parseRequestLine, splitFields, withoutQuery } from './alb-log-parser';

const TARGET_GROUP = 'arn:aws:elasticloadbalancing:eu-central-1:111111111111:targetgroup/game-api/73e2d6bc24d8a067';

const HTTP_1 = `https 2026-11-11T10:00:01.186641Z app/game-alb/50dc6c495c0c9188 172.70.1.9:2817 10.0.0.1:8080 0.000 0.012 0.000 200 200 34 366 "GET https://api.example.com:443/v1/players/42?token=secret HTTP/1.1" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" ECDHE-RSA-AES128-GCM-SHA256 TLSv1.2 ${TARGET_GROUP} "Root=1-58337262-36d228ad5d99923122bbe354" "api.example.com" "arn:aws:acm:eu-central-1:111111111111:certificate/abc" 0 2026-11-11T10:00:01.174000Z "forward" "-" "-" "10.0.0.1:8080" "200" "-" "-" TID_1234abcd`;

const HTTP_2 = `h2 2026-11-11T10:00:02.000001Z app/game-alb/50dc6c495c0c9188 2606:4700::1:48160 10.0.0.66:9000 0.001 0.250 0.000 502 502 5 257 "POST https://game.example.com:443/rpc HTTP/2.0" "okhttp/4.12.0" TLS_AES_128_GCM_SHA256 TLSv1.3 ${TARGET_GROUP} "Root=1-58337327-72bd00b0343d75b906739c42" "game.example.com" "-" 1 2026-11-11T10:00:01.750000Z "forward" "-" "-" "10.0.0.66:9000" "502" "-" "-" TID_5678`;

const NO_TARGET = `https 2026-11-11T10:00:03.000000Z app/game-alb/50dc6c495c0c9188 172.70.1.9:5555 - -1 -1 -1 404 - 120 200 "GET https://unknown.example.com:443/wp-login.php HTTP/1.1" "Mozilla \\"scanner\\" 1.0" TLS_AES_128_GCM_SHA256 TLSv1.3 - "Root=1-1" "unknown.example.com" "-" 0 2026-11-11T10:00:03.000000Z "fixed-response" "-" "-" "-" "-" "-" "-" TID_9`;

const MALFORMED = `http 2026-11-11T10:00:04.000000Z app/game-alb/50dc6c495c0c9188 172.70.1.9:6000 - -1 -1 -1 400 - 0 0 "- http://203.0.113.10:80- -" "-" - - - "-" "-" "-" - 2026-11-11T10:00:04.000000Z "-" "-" "-" "-" "-" "-" "-" -`;

describe('splitFields', () => {
  it('keeps quoted fields whole and unescapes quotes inside them', () => {
    expect(splitFields('a "b c" "d \\"e\\"" - "" f')).toEqual(['a', 'b c', 'd "e"', '-', '', 'f']);
  });
});

describe('parseAccessLine', () => {
  it('reads a forwarded HTTP/1.1 request', () => {
    expect(parseAccessLine(HTTP_1)).toEqual({
      time: '2026-11-11T10:00:01.186641Z',
      host: 'api.example.com',
      method: 'GET',
      path: '/v1/players/42?token=secret',
      elbStatus: 200,
      targetStatus: 200,
      responseMs: 12,
      service: 'game-api',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      edgeIp: '172.70.1.9',
      protocol: 'HTTP/1.1',
    });
  });

  it('reads an HTTP/2 request from an IPv6 edge', () => {
    expect(parseAccessLine(HTTP_2)).toMatchObject({
      host: 'game.example.com',
      method: 'POST',
      path: '/rpc',
      elbStatus: 502,
      responseMs: 251,
      edgeIp: '2606:4700::1',
      protocol: 'HTTP/2.0',
    });
  });

  it('reads a request the load balancer answered without a target', () => {
    expect(parseAccessLine(NO_TARGET)).toMatchObject({
      host: 'unknown.example.com',
      elbStatus: 404,
      targetStatus: null,
      responseMs: null,
      service: null,
      userAgent: 'Mozilla "scanner" 1.0',
    });
  });

  it('reads a malformed request line', () => {
    expect(parseAccessLine(MALFORMED)).toMatchObject({
      method: '-',
      host: '203.0.113.10',
      elbStatus: 400,
      userAgent: '',
      service: null,
    });
  });

  it('skips lines that are not access log entries', () => {
    expect(parseAccessLine('')).toBeNull();
    expect(parseAccessLine('not a log line')).toBeNull();
    expect(parseAccessLine(HTTP_1.replace('2026-11-11T10:00:01.186641Z', 'yesterday'))).toBeNull();
  });
});

describe('request helpers', () => {
  it('splits the request line and drops query strings', () => {
    expect(parseRequestLine('GET https://a.example.com:443/x?y=1 HTTP/2.0')).toEqual({
      method: 'GET',
      host: 'a.example.com',
      path: '/x?y=1',
      protocol: 'HTTP/2.0',
    });
    expect(withoutQuery('/x?y=1&z=2')).toBe('/x');
    expect(withoutQuery('/x')).toBe('/x');
  });
});

describe('parseConnectionLine', () => {
  it('reads successful and failed TLS handshakes', () => {
    const ok = `2026-11-11T10:00:05.514108Z 172.70.1.9 36280 443 TLSv1.3 TLS_AES_128_GCM_SHA256 4.036 - - - Success TID_3180a7 - app/game-alb/50dc 10.0.1.5`;
    const failed = `2026-11-11T10:00:06.514108Z 172.70.1.9 36281 443 TLSv1.2 ECDHE-RSA-AES128-GCM-SHA256 - "CN=client,O=Example" NotBefore=2023-09-21T22:43:21Z;NotAfter=2026-06-17T22:43:21Z FEF257372D5C14D4 Failed:ClientCertUntrusted TID_1c71a6`;
    expect(parseConnectionLine(ok)).toEqual({
      time: '2026-11-11T10:00:05.514108Z',
      edgeIp: '172.70.1.9',
      listenerPort: 443,
      tlsProtocol: 'TLSv1.3',
      tlsCipher: 'TLS_AES_128_GCM_SHA256',
      handshakeMs: 4036,
      result: 'Success',
    });
    expect(parseConnectionLine(failed)).toMatchObject({ handshakeMs: null, result: 'Failed:ClientCertUntrusted' });
  });
});
