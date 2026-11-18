import { z } from 'zod';

const ROLE_ARN = /^arn:aws[a-z-]*:iam::\d{12}:role\/[\w+=,.@/-]{1,512}$/;
const REGION = /^[a-z]{2}(-[a-z]+)+-\d$/;
const NAME = /^[\w.-]{1,255}$/;

const optional = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || null);

const schema = z.object({
  PRODUCTION_RELEASES_ROLE_ARN: optional.pipe(z.string().regex(ROLE_ARN).nullable()),
  PRODUCTION_RELEASES_PROJECT: optional,
  PRODUCTION_RELEASES_REGION: z.string().trim().regex(REGION).default('eu-central-1'),
  PRODUCTION_RELEASES_TABLE: z.string().trim().regex(NAME).default('dreamzino-production-releases'),
  PRODUCTION_RELEASES_DECIDE_FUNCTION: z.string().trim().regex(NAME).default('dreamzino-production-release-decide'),
});

export interface ProductionReleasesSettings {
  roleArn: string;
  /** The slug of the project that shows production releases. */
  projectSlug: string;
  region: string;
  table: string;
  decideFunction: string;
}

/** The settings, or null while the role or project isn't set, which turns the page off. */
export type ProductionReleasesSetup = ProductionReleasesSettings | null;

export const PRODUCTION_RELEASES_SETUP = Symbol('PRODUCTION_RELEASES_SETUP');

export const loadProductionReleasesSetup = (env: NodeJS.ProcessEnv): ProductionReleasesSetup => {
  const result = schema.safeParse(env);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map(({ path }) => String(path[0])))];
    throw new Error(`Check these settings: ${names.join(', ')}`);
  }
  const value = result.data;
  if (!value.PRODUCTION_RELEASES_ROLE_ARN || !value.PRODUCTION_RELEASES_PROJECT) {
    return null;
  }
  return {
    roleArn: value.PRODUCTION_RELEASES_ROLE_ARN,
    projectSlug: value.PRODUCTION_RELEASES_PROJECT,
    region: value.PRODUCTION_RELEASES_REGION,
    table: value.PRODUCTION_RELEASES_TABLE,
    decideFunction: value.PRODUCTION_RELEASES_DECIDE_FUNCTION,
  };
};
