export type TimeMode = 'utc' | 'local';

export const formatTime = (iso: string, mode: TimeMode = 'utc'): string =>
  new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(mode === 'utc' ? { timeZone: 'UTC' } : {}),
  }).format(new Date(iso));

/** Down to the second, for log lines: 11 Nov, 14:05:09. */
export const formatPreciseTime = (iso: string, mode: TimeMode = 'utc'): string =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    ...(mode === 'utc' ? { timeZone: 'UTC' } : {}),
  }).format(new Date(iso));

const offsetLabel = (offsetMinutes: number): string => {
  const hours = Math.trunc(Math.abs(offsetMinutes) / 60);
  const minutes = Math.abs(offsetMinutes) % 60;
  const sign = offsetMinutes > 0 ? '-' : '+';
  if (offsetMinutes === 0) {
    return 'UTC';
  }
  return `UTC${sign}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`;
};

export const zoneLabel = (mode: TimeMode, offsetMinutes = new Date().getTimezoneOffset()): string =>
  mode === 'utc' ? 'UTC' : `Local (${offsetLabel(offsetMinutes)})`;

const KEY_LABELS: Record<string, string> = {
  multiAz: 'Multi-AZ',
  rolloutState: 'Deployment',
  storageGb: 'Storage GB',
  privateIp: 'Private IP',
  publicIp: 'Public IP',
  dnsName: 'DNS name',
  cidrBlock: 'CIDR',
  vpcId: 'VPC',
  subnetId: 'Subnet',
  storageEncrypted: 'Storage encrypted',
  encryptedInTransit: 'Encrypted in transit',
  encryptedAtRest: 'Encrypted at rest',
  serverlessMinAcu: 'Serverless minimum ACU',
  serverlessMaxAcu: 'Serverless maximum ACU',
};

export const humanizeKey = (key: string): string => {
  const label = KEY_LABELS[key];
  if (label) {
    return label;
  }
  const words = key.replace(/([A-Z])/g, ' $1').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export const formatValue = (value: unknown): string => {
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  return String(value);
};

export const formatDuration = (seconds: number | null): string => {
  if (seconds === null) {
    return '—';
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
};

const TIME_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

export const formatRelativeTime = (iso: string | null, now: number): string => {
  if (!iso) {
    return '—';
  }
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const unit = TIME_UNITS.find(([, size]) => Math.abs(seconds) >= size);
  return unit
    ? formatter.format(Math.round(seconds / unit[1]), unit[0])
    : 'just now';
};
