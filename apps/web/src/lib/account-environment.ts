import type { CloudAccount } from '@pulsegrid/shared';

type AccountEnvironment = Pick<CloudAccount, 'environmentName' | 'isProduction'>;

const STAGING = /\b(stage|staging|stg)\b/i;
const NO_ENVIRONMENT = 'No environment';

export const environmentLabel = ({ environmentName }: AccountEnvironment): string =>
  environmentName ?? NO_ENVIRONMENT;

export const environmentTone = ({
  environmentName,
  isProduction,
}: AccountEnvironment): 'danger' | 'warning' | 'neutral' => {
  if (isProduction) {
    return 'danger';
  }
  return environmentName && STAGING.test(environmentName) ? 'warning' : 'neutral';
};
