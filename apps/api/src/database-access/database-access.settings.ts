import { z } from 'zod';

const STATE_MACHINE = /^arn:aws[a-z-]*:states:([a-z]{2}-[a-z]+-\d):(\d{12}):stateMachine:[\w-]+$/;
const stateMachine = z.string().regex(STATE_MACHINE, 'Must be a Step Functions state machine ARN');
const optional = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

const schema = z.object({
  DB_ACCESS_GRANT_STATE_MACHINE_ARN: stateMachine,
  DB_ACCESS_REVOKE_STATE_MACHINE_ARN: stateMachine,
  DB_ACCESS_SCHEDULE_GROUP: z.string().regex(/^[\w.-]{1,64}$/),
  DB_ACCESS_SSO_START_URL: optional.pipe(z.url().optional()),
  DB_ACCESS_SSO_REGION: optional.pipe(
    z
      .string()
      .regex(/^[a-z]{2}-[a-z]+-\d$/)
      .optional(),
  ),
  DB_ACCESS_PROFILE: z
    .string()
    .regex(/^[\w-]{1,64}$/)
    .default('production-db'),
  DB_ACCESS_ROLE_NAME: z.string().min(1).default('ProductionDatabaseReadOnly'),
  DB_ACCESS_TUNNEL_INSTANCE_ID: optional.pipe(
    z
      .string()
      .regex(/^i-[0-9a-f]+$/)
      .optional(),
  ),
  DB_ACCESS_READER_ENDPOINT: optional,
  DB_ACCESS_PORT: z.coerce.number().int().positive().default(5432),
  DB_ACCESS_DATABASE: optional,
  DB_ACCESS_DB_USER: z.string().min(1).default('readonly_access'),
});

export interface DatabaseAccessConnectSettings {
  ssoStartUrl: string;
  ssoRegion: string;
  profile: string;
  roleName: string;
  tunnelInstanceId: string;
  readerEndpoint: string;
  port: number;
  database: string;
  user: string;
}

export interface DatabaseAccessSettings {
  grantStateMachineArn: string;
  revokeStateMachineArn: string;
  scheduleGroup: string;
  /** The Production account and region, read from the workflows' ARNs. */
  accountId: string;
  region: string;
  /** The connect steps, once every value is set; until then the page says which are missing. */
  connect: DatabaseAccessConnectSettings | null;
  missingConnect: string[];
}

/** Either the feature's settings, or the variables that are missing or wrong, so the page can say what to fix. */
export type DatabaseAccessSetup =
  { ready: true; settings: DatabaseAccessSettings } | { ready: false; problems: string[] };

export const DATABASE_ACCESS_SETUP = Symbol('DATABASE_ACCESS_SETUP');

const CONNECT_KEYS = [
  'DB_ACCESS_SSO_START_URL',
  'DB_ACCESS_TUNNEL_INSTANCE_ID',
  'DB_ACCESS_READER_ENDPOINT',
  'DB_ACCESS_DATABASE',
] as const;

export const loadDatabaseAccessSetup = (env: NodeJS.ProcessEnv): DatabaseAccessSetup => {
  const result = schema.safeParse(env);
  if (!result.success) {
    return { ready: false, problems: [...new Set(result.error.issues.map(({ path }) => String(path[0])))] };
  }
  const value = result.data;
  const [, region = '', accountId = ''] = STATE_MACHINE.exec(value.DB_ACCESS_GRANT_STATE_MACHINE_ARN) ?? [];
  const [, revokeRegion, revokeAccount] = STATE_MACHINE.exec(value.DB_ACCESS_REVOKE_STATE_MACHINE_ARN) ?? [];
  if (revokeRegion !== region || revokeAccount !== accountId) {
    return { ready: false, problems: ['DB_ACCESS_REVOKE_STATE_MACHINE_ARN'] };
  }
  const missingConnect = CONNECT_KEYS.filter((key) => !value[key]);
  return {
    ready: true,
    settings: {
      grantStateMachineArn: value.DB_ACCESS_GRANT_STATE_MACHINE_ARN,
      revokeStateMachineArn: value.DB_ACCESS_REVOKE_STATE_MACHINE_ARN,
      scheduleGroup: value.DB_ACCESS_SCHEDULE_GROUP,
      accountId,
      region,
      missingConnect,
      connect:
        missingConnect.length > 0
          ? null
          : {
              ssoStartUrl: value.DB_ACCESS_SSO_START_URL ?? '',
              ssoRegion: value.DB_ACCESS_SSO_REGION ?? region,
              profile: value.DB_ACCESS_PROFILE,
              roleName: value.DB_ACCESS_ROLE_NAME,
              tunnelInstanceId: value.DB_ACCESS_TUNNEL_INSTANCE_ID ?? '',
              readerEndpoint: value.DB_ACCESS_READER_ENDPOINT ?? '',
              port: value.DB_ACCESS_PORT,
              database: value.DB_ACCESS_DATABASE ?? '',
              user: value.DB_ACCESS_DB_USER,
            },
    },
  };
};
