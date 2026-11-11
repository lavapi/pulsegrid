const STAMP = /_(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})Z_/;
const FILE_SPAN_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const LOAD_BALANCER_ID = /:loadbalancer\/app\/([^/]+)\/([^/]+)$/;

export type AlbLogKind = 'access' | 'connection';

export interface AlbLogLocation {
  bucket: string;
  prefix: string;
  /** The account that owns the load balancer, which AWS puts in the file path. */
  accountId: string;
  region: string;
  loadBalancerArn: string;
}

export interface AlbLogFile {
  key: string;
  /** When the file's 5-minute interval ends. */
  endsAt: number;
}

/** The id AWS uses in log file names, like app.my-alb.50dc6c495c0c9188, or null for other kinds of load balancer. */
export const fileLoadBalancerId = (arn: string): string | null => {
  const match = LOAD_BALANCER_ID.exec(arn);
  return match ? `app.${match[1]}.${match[2]}` : null;
};

const twoDigits = (value: number): string => String(value).padStart(2, '0');

const dayPath = (time: number): string => {
  const day = new Date(time);
  return `${day.getUTCFullYear()}/${twoDigits(day.getUTCMonth() + 1)}/${twoDigits(day.getUTCDate())}/`;
};

const stamp = (time: number): string => {
  const at = new Date(time);
  return `${at.getUTCFullYear()}${twoDigits(at.getUTCMonth() + 1)}${twoDigits(at.getUTCDate())}T${twoDigits(at.getUTCHours())}${twoDigits(at.getUTCMinutes())}Z`;
};

/** The start of every key of one load balancer's files on one day: AWS's standard log path. */
export const dayKeyPrefix = (location: AlbLogLocation, kind: AlbLogKind, time: number): string | null => {
  const id = fileLoadBalancerId(location.loadBalancerArn);
  if (!id) {
    return null;
  }
  const folder = location.prefix ? `${location.prefix.replace(/\/+$/, '')}/` : '';
  const name = `${location.accountId}_elasticloadbalancing_${location.region}_${id}_`;
  return `${folder}AWSLogs/${location.accountId}/elasticloadbalancing/${location.region}/${dayPath(time)}${kind === 'connection' ? `conn_log_${name}` : name}`;
};

/** Where to start listing a day so the files before the range are skipped. */
export const startAfter = (dayPrefix: string, from: number): string => `${dayPrefix}${stamp(from)}`;

/** How long after its interval AWS may deliver a file, which can put it in the next day's folder. */
const DELIVERY_LAG_MS = 15 * 60_000;

/** The day folders a range's files can be in: AWS files them by the day they were delivered. */
export const daysOf = (from: number, to: number): number[] => {
  const days: number[] = [];
  const end = to + FILE_SPAN_MS + DELIVERY_LAG_MS;
  const last = Date.UTC(new Date(end).getUTCFullYear(), new Date(end).getUTCMonth(), new Date(end).getUTCDate());
  for (
    let day = Date.UTC(new Date(from).getUTCFullYear(), new Date(from).getUTCMonth(), new Date(from).getUTCDate());
    day <= last;
    day += DAY_MS
  ) {
    days.push(day);
  }
  return days;
};

/** When a file's interval ends, read from its name, or null when the name isn't a log file's. */
export const fileEnd = (key: string): number | null => {
  const match = STAMP.exec(key);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute] = match.map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0);
};

/** Whether a file can hold lines from the range: its 5 minutes overlap it, with a minute of slack for late lines. */
export const overlaps = (endsAt: number, from: number, to: number): boolean =>
  endsAt > from && endsAt - FILE_SPAN_MS <= to + 60_000;

/** Files ending at the same moment, newest first: one per load balancer node. */
export const newestFirstGroups = (files: readonly AlbLogFile[]): AlbLogFile[][] => {
  const groups = new Map<number, AlbLogFile[]>();
  for (const file of files) {
    groups.set(file.endsAt, [...(groups.get(file.endsAt) ?? []), file]);
  }
  return [...groups.entries()].sort(([a], [b]) => b - a).map(([, group]) => group);
};

/** How far after its interval a file can still hold a line, so a page knows when older files can't beat it. */
export const LATE_LINE_MS = 60_000;
