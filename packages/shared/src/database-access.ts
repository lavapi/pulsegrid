export type DatabaseAccessStatus = 'granting' | 'active' | 'revoked' | 'expired' | 'failed';
export type DatabaseAccessChange = 'extending' | 'revoking';
export type DatabaseAccessEndReason = 'manual' | 'expired';

export const DATABASE_ACCESS_MAX_HOURS = 8;
export const DATABASE_ACCESS_LOCAL_PORT = 15432;

export interface DatabaseAccessGrant {
  id: string;
  grantedBy: string;
  userName: string;
  userId: string | null;
  reason: string;
  status: DatabaseAccessStatus;
  /** A change running in AWS on active access. */
  change: DatabaseAccessChange | null;
  /** Why the grant or the last change failed, in plain words. */
  failure: string | null;
  startsAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  endReason: DatabaseAccessEndReason | null;
}

/** Access AWS has that PulseGrid didn't grant, from the expiry schedules. */
export interface OutsideDatabaseAccess {
  userId: string;
  expiresAt: string | null;
}

export interface DatabaseAccessConnect {
  ssoStartUrl: string;
  /** Where IAM Identity Center runs, for the SSO session in the person's AWS config. */
  ssoRegion: string;
  /** The AWS CLI profile name the steps use. */
  profile: string;
  accountId: string;
  roleName: string;
  region: string;
  tunnelInstanceId: string;
  readerEndpoint: string;
  port: number;
  localPort: number;
  database: string;
  user: string;
}

export type DatabaseAccessView =
  | {
      ready: true;
      maxHours: number;
      grants: DatabaseAccessGrant[];
      outside: OutsideDatabaseAccess[];
      /** When the outside list was last read from AWS, or null before the first reconcile. */
      outsideCheckedAt: string | null;
      connect: DatabaseAccessConnect | null;
      /** Settings still needed for the connect steps. */
      missingConnect: string[];
    }
  /** Not set up, with the settings to fix for people who manage it. */
  | { ready: false; problems: string[] };

export interface GrantDatabaseAccessInput {
  userName: string;
  hours: number;
  reason: string;
  code: string;
}

export interface ExtendDatabaseAccessInput {
  hours: number;
  code: string;
}

export interface RevokeDatabaseAccessInput {
  code: string;
}
