import { z } from 'zod';

const ROLE_ARN = /^arn:aws[a-z-]*:iam::(\d{12}):role\/(?:[\w+=,.@-]+\/)*([\w+=,.@-]{1,64})$/;

const roleSchema = z.object({
  roleArn: z.string().trim().regex(ROLE_ARN),
  externalId: z.string().regex(/^[\w+=,.@:/-]{2,1224}$/),
});

/** Credentials to call AWS with: a role's temporary ones, which also name the role. */
export type AwsKey = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  roleArn?: string;
};

/** How an AWS account is connected: a role PulseGrid takes on with its own task role. Nothing secret is stored. */
export type AwsConnection = z.infer<typeof roleSchema>;

export const parseAwsConnection = (input: unknown): AwsConnection | null => {
  const parsed = roleSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
};

export const roleParts = (roleArn: string): { accountId: string; name: string } | null => {
  const [, accountId, name] = ROLE_ARN.exec(roleArn) ?? [];
  return accountId && name ? { accountId, name } : null;
};

/** What the account card shows: the role's name, never its External ID. */
export const connectionHint = ({ roleArn }: AwsConnection): string => `Role ${roleParts(roleArn)?.name ?? roleArn}`;
