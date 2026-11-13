import type { DatabaseAccessConnect, DatabaseAccessGrant } from '@pulsegrid/shared';

const MS_PER_MINUTE = 60_000;

/** Time left as "2 h 05 min" or "4 min", or null once it has ended. */
export const timeLeft = (expiresAt: string, now: number): string | null => {
  const minutes = Math.ceil((Date.parse(expiresAt) - now) / MS_PER_MINUTE);
  if (minutes <= 0) {
    return null;
  }
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${String(minutes % 60).padStart(2, '0')} min` : `${minutes} min`;
};

export const STATUS_LABELS: Record<DatabaseAccessGrant['status'], string> = {
  granting: 'Granting',
  active: 'Active',
  revoked: 'Revoked',
  expired: 'Expired',
  failed: 'Failed',
};

/** What a grant is doing now, while AWS works on it. */
export const progressOf = ({ status, change }: DatabaseAccessGrant): string | null => {
  if (status === 'granting') {
    return 'Granting in AWS, usually 1 to 2 minutes';
  }
  if (change === 'extending') {
    return 'Extending in AWS';
  }
  return change === 'revoking' ? 'Revoking in AWS' : null;
};

/** How a grant in the history ended. */
export const endingOf = ({ status, endReason, revokedBy, failure }: DatabaseAccessGrant): string => {
  if (status === 'failed') {
    return `Failed: ${failure ?? 'unknown reason'}`;
  }
  const how = endReason === 'manual' ? 'Revoked' : 'Expired';
  return `${how}${revokedBy ? ` by ${revokedBy}` : ''}${failure ? `. ${failure}` : ''}`;
};

export interface ConnectStep {
  title: string;
  text?: string;
  command?: string;
}

/** What the person runs to connect: sign in with SSO, open the tunnel, get a token, then point their client at it. */
export const connectSteps = (connect: DatabaseAccessConnect, profile = 'production-db'): ConnectStep[] => [
  {
    title: 'Set up and sign in to AWS',
    text: `Run once, choosing account ${connect.accountId} and role ${connect.roleName}, and name the profile ${profile}. SSO start URL: ${connect.ssoStartUrl}, region ${connect.region}.`,
    command: `aws configure sso --profile ${profile}\naws sso login --profile ${profile}`,
  },
  {
    title: 'Open the tunnel and keep it running',
    command: `aws ssm start-session --profile ${profile} --region ${connect.region} --target ${connect.tunnelInstanceId} --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters host=${connect.readerEndpoint},portNumber=${connect.port},localPortNumber=${connect.localPort}`,
  },
  {
    title: 'Get a password token',
    text: 'In a second terminal. A token opens connections for 15 minutes; connections already open stay up until access ends.',
    command: `aws rds generate-db-auth-token --profile ${profile} --hostname ${connect.readerEndpoint} --port ${connect.port} --username ${connect.user} --region ${connect.region}`,
  },
  {
    title: 'Connect with Navicat or DBeaver',
    text: `Host localhost, port ${connect.localPort}, database ${connect.database}, user ${connect.user}, password: the token, SSL mode require.`,
  },
];
