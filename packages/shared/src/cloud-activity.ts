export interface CloudActivityEvent {
  id: string;
  occurredAt: string;
  actor: string;
  action: string;
  label: string;
  resource: string | null;
  region: string;
  sourceIp: string | null;
  errorCode: string | null;
  viaDashboard: boolean;
}

export interface CloudActivityPage {
  events: CloudActivityEvent[];
  before: string | null;
  error: string | null;
}
