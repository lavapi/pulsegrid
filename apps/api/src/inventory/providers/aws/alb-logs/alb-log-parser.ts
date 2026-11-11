import type { ConnectionLogEntry, RequestLogEntry } from '@pulsegrid/shared';

const QUOTE = '"';
const BACKSLASH = '\\';
const MISSING = '-';
const MS_PER_SECOND = 1000;
const ACCESS_FIELDS = 19;
const CONNECTION_FIELDS = 11;
const REQUEST_LINE = /^(\S+) (.+) (\S+)$/;
const ADDRESS_WITH_PORT = /^\[?(.*?)\]?:(\d+)$/;
const TARGET_GROUP_NAME = /:targetgroup\/([^/]+)\//;
const URL_HOST = /^\w+:\/\/\[?([^/\]:]+)/;

/** Splits a log line on spaces, keeping "quoted fields" whole and unescaping \" and \\ inside them. */
export const splitFields = (line: string): string[] => {
  const fields: string[] = [];
  let index = 0;
  while (index < line.length) {
    if (line[index] === ' ') {
      index += 1;
      continue;
    }
    if (line[index] === QUOTE) {
      let value = '';
      index += 1;
      while (index < line.length && line[index] !== QUOTE) {
        if (line[index] === BACKSLASH && index + 1 < line.length) {
          index += 1;
        }
        value += line[index];
        index += 1;
      }
      fields.push(value);
      index += 1;
      continue;
    }
    const end = line.indexOf(' ', index);
    fields.push(line.slice(index, end === -1 ? line.length : end));
    index = end === -1 ? line.length : end;
  }
  return fields;
};

const status = (value: string | undefined): number | null => {
  const code = Number(value);
  return value && value !== MISSING && Number.isInteger(code) ? code : null;
};

const seconds = (value: string | undefined): number | null => {
  const parsed = Number(value);
  return value && value !== MISSING && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const addressOf = (value: string | undefined): string => {
  if (!value || value === MISSING) {
    return MISSING;
  }
  return ADDRESS_WITH_PORT.exec(value)?.[1] ?? value;
};

const responseMs = (request: string, target: string, response: string): number | null => {
  const parts = [seconds(request), seconds(target), seconds(response)];
  if (parts.some((part) => part === null)) {
    return null;
  }
  const total = parts.reduce<number>((sum, part) => sum + (part ?? 0), 0);
  return Math.round(total * MS_PER_SECOND * 10) / 10;
};

const serviceOf = (targetGroupArn: string | undefined): string | null =>
  targetGroupArn && targetGroupArn !== MISSING ? (TARGET_GROUP_NAME.exec(targetGroupArn)?.[1] ?? targetGroupArn) : null;

interface RequestParts {
  method: string;
  host: string;
  path: string;
  protocol: string;
}

/** Reads "GET https://host:443/path?query HTTP/2.0", including the "- http://host:80- -" lines of rejected requests. */
export const parseRequestLine = (request: string): RequestParts => {
  const match = REQUEST_LINE.exec(request);
  if (!match) {
    return { method: MISSING, host: '', path: request, protocol: MISSING };
  }
  const [, method = MISSING, target = '', protocol = MISSING] = match;
  try {
    const url = new URL(target);
    return { method, host: url.hostname, path: `${url.pathname}${url.search}`, protocol };
  } catch {
    return { method, host: URL_HOST.exec(target)?.[1] ?? '', path: target, protocol };
  }
};

/** The path without its query string. */
export const withoutQuery = (path: string): string => {
  const index = path.indexOf('?');
  return index === -1 ? path : path.slice(0, index);
};

/** One line of an Application Load Balancer access log, or null when it isn't one. */
export const parseAccessLine = (line: string): RequestLogEntry | null => {
  const fields = splitFields(line);
  if (fields.length < ACCESS_FIELDS) {
    return null;
  }
  const time = fields[1] ?? '';
  if (Number.isNaN(Date.parse(time))) {
    return null;
  }
  const request = parseRequestLine(fields[12] ?? '');
  const domain = fields[18];
  return {
    time,
    host: request.host || (domain && domain !== MISSING ? domain : ''),
    method: request.method,
    path: request.path,
    elbStatus: status(fields[8]),
    targetStatus: status(fields[9]),
    responseMs: responseMs(fields[5] ?? '', fields[6] ?? '', fields[7] ?? ''),
    service: serviceOf(fields[16]),
    userAgent: fields[13] === MISSING ? '' : (fields[13] ?? ''),
    edgeIp: addressOf(fields[3]),
    protocol: request.protocol,
  };
};

/** One line of an Application Load Balancer connection log, or null when it isn't one. */
export const parseConnectionLine = (line: string): ConnectionLogEntry | null => {
  const fields = splitFields(line);
  if (fields.length < CONNECTION_FIELDS) {
    return null;
  }
  const time = fields[0] ?? '';
  if (Number.isNaN(Date.parse(time))) {
    return null;
  }
  const latency = seconds(fields[6]);
  return {
    time,
    edgeIp: fields[1] ?? MISSING,
    listenerPort: status(fields[3]),
    tlsProtocol: fields[4] ?? MISSING,
    tlsCipher: fields[5] ?? MISSING,
    handshakeMs: latency === null ? null : Math.round(latency * MS_PER_SECOND * 10) / 10,
    result: fields[10] ?? MISSING,
  };
};
