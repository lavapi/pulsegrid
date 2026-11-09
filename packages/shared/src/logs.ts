export interface LogLine {
  id: string;
  timestamp: string;
  stream: string;
  message: string;
}

export interface LogAccess {
  allowed: boolean;
  reason: string | null;
}

export interface LogView {
  access: LogAccess;
  available: boolean;
  lines: LogLine[];
  error: string | null;
}

export const LOG_RANGES = [
  { id: '15m', label: '15 minutes', minutes: 15 },
  { id: '1h', label: '1 hour', minutes: 60 },
  { id: '6h', label: '6 hours', minutes: 360 },
  { id: '24h', label: '24 hours', minutes: 1440 },
] as const;
