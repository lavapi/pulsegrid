import { z } from 'zod';

const VISIBLE_PREFIX = 4;
const VISIBLE_SUFFIX = 4;
const ROOT_ARN_SUFFIX = ':root';
const ROLE_ARN = /^arn:aws[a-z-]*:iam::(\d{12}):role\/(?:[\w+=,.@-]+\/)*([\w+=,.@-]{1,64})$/;

const storedKeySchema = z.object({
  accessKeyId: z.string().trim().regex(/^AKIA[A-Z0-9]{16}$/),
  secretAccessKey: z.string().trim().regex(/^[A-Za-z0-9/+=]{40}$/),
});

const roleSchema = z.object({
  roleArn: z.string().trim().regex(ROLE_ARN),
  externalId: z.string().regex(/^[\w+=,.@:/-]{2,1224}$/),
});

/** Credentials to call AWS with: a stored key, or a role's temporary ones, which also name the role. */
export type AwsKey = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  roleArn?: string;
};

export type StoredAwsKey = z.infer<typeof storedKeySchema>;

/** A role in the account that PulseGrid assumes with its own task role; nothing secret is stored. */
export type AwsRole = z.infer<typeof roleSchema>;

/** How an AWS account is connected: a long-lived access key, or a role. */
export type AwsConnection = StoredAwsKey | AwsRole;

export const isAwsRole = (connection: AwsConnection): connection is AwsRole => 'roleArn' in connection;

/** A role when the input names one, otherwise an access key; null when neither is in the right format. */
export const parseAwsConnection = (input: unknown): AwsConnection | null => {
  const schema = typeof input === 'object' && input !== null && 'roleArn' in input ? roleSchema : storedKeySchema;
  const parsed = schema.safeParse(input);
  return parsed.success ? parsed.data : null;
};

export const roleParts = (roleArn: string): { accountId: string; name: string } | null => {
  const [, accountId, name] = ROLE_ARN.exec(roleArn) ?? [];
  return accountId && name ? { accountId, name } : null;
};

/** What the account card shows: the role's name, or the start and end of the key. */
export const connectionHint = (connection: AwsConnection): string =>
  isAwsRole(connection)
    ? `Role ${roleParts(connection.roleArn)?.name ?? connection.roleArn}`
    : `${connection.accessKeyId.slice(0, VISIBLE_PREFIX)}…${connection.accessKeyId.slice(-VISIBLE_SUFFIX)}`;

export const isRootArn = (arn: string): boolean => arn.endsWith(ROOT_ARN_SUFFIX);
