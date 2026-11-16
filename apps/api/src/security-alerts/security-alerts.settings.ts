import { z } from 'zod';

export const DEFAULT_TOPIC_ARN = 'arn:aws:sns:eu-central-1:040496249361:security-events';

const TOPIC_ARN = /^arn:aws[a-z-]*:sns:[a-z]{2}(-[a-z]+)+-\d:\d{12}:[\w-]{1,256}$/;
const ACCOUNT_NAME = /^(\d{12})=(.{1,80})$/;

const list = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const schema = z.object({
  SECURITY_ALERTS_PROJECT: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || null),
  SECURITY_ALERTS_TOPIC_ARNS: z
    .string()
    .default(DEFAULT_TOPIC_ARN)
    .transform(list)
    .pipe(z.array(z.string().regex(TOPIC_ARN)).min(1)),
  SECURITY_ALERTS_ACCOUNT_NAMES: z
    .string()
    .default('')
    .transform(list)
    .pipe(z.array(z.string().regex(ACCOUNT_NAME))),
});

export interface SecurityAlertsSettings {
  /** The slug of the project that receives the alerts, or null while it isn't set. */
  projectSlug: string | null;
  topicArns: ReadonlySet<string>;
  accountNames: ReadonlyMap<string, string>;
}

export const SECURITY_ALERTS_SETTINGS = Symbol('SECURITY_ALERTS_SETTINGS');

/** Reads the settings, failing at startup with the names of the variables that are wrong. */
export const loadSecurityAlertsSettings = (env: NodeJS.ProcessEnv): SecurityAlertsSettings => {
  const result = schema.safeParse(env);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map(({ path }) => String(path[0])))];
    throw new Error(`Check these settings: ${names.join(', ')}`);
  }
  const value = result.data;
  return {
    projectSlug: value.SECURITY_ALERTS_PROJECT,
    topicArns: new Set(value.SECURITY_ALERTS_TOPIC_ARNS),
    accountNames: new Map(
      value.SECURITY_ALERTS_ACCOUNT_NAMES.map((pair) => {
        const [, id = '', name = ''] = ACCOUNT_NAME.exec(pair) ?? [];
        return [id, name.trim()];
      }),
    ),
  };
};
