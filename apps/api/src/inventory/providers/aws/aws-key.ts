import { z } from 'zod';

const VISIBLE_PREFIX = 4;
const VISIBLE_SUFFIX = 4;
const ROOT_ARN_SUFFIX = ':root';

const awsKeySchema = z.object({
  accessKeyId: z.string().trim().regex(/^AKIA[A-Z0-9]{16}$/),
  secretAccessKey: z.string().trim().regex(/^[A-Za-z0-9/+=]{40}$/),
});

export type AwsKey = z.infer<typeof awsKeySchema>;

export const parseAwsKey = (input: unknown): AwsKey | null => {
  const parsed = awsKeySchema.safeParse(input);
  return parsed.success ? parsed.data : null;
};

export const keyHint = ({ accessKeyId }: AwsKey): string =>
  `${accessKeyId.slice(0, VISIBLE_PREFIX)}…${accessKeyId.slice(-VISIBLE_SUFFIX)}`;

export const isRootArn = (arn: string): boolean => arn.endsWith(ROOT_ARN_SUFFIX);
