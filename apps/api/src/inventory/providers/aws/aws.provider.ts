import { type CloudProvider, defineProvider } from '../provider';
import { AWS_ACTIONS } from './aws-actions';
import { AWS_ACTIVITY_WATCHES } from './aws-activity';
import { actionErrorMessage, collectorErrorMessage } from './aws-error-messages';
import { type AwsKey, keyHint, parseAwsKey } from './aws-key';
import { checkAwsKey } from './aws-key-checker';
import { buildAwsMap } from './aws-map';
import { isAwsRegion } from './aws-region';
import { AWS_ACTIVITY_SOURCE } from './aws-cloudtrail';
import { AWS_COST_SOURCE } from './aws-costs';
import { AWS_DEPLOYMENT_SOURCE } from './aws-deployments';
import { AWS_EXPERIMENT_SOURCE } from './aws-fis';
import { ALB_REQUEST_LOG_SOURCE } from './alb-logs/alb-log-reader';
import { AWS_LOG_SOURCE } from './aws-logs';
import { RDS_ACTIVITY_SOURCE } from './database-activity';
import { AWS_METRIC_SOURCE } from './aws-metrics';
import { AWS_SECRET_STORE } from './aws-secrets';
import { AWS_COLLECTORS } from './collectors';

const awsProviderOf: CloudProvider<AwsKey> = {
  id: 'aws',
  collectors: AWS_COLLECTORS,
  unfilteredTypes: ['vpc', 'subnet', 'security-group'],
  actions: AWS_ACTIONS,
  activityWatches: AWS_ACTIVITY_WATCHES,
  secretStore: AWS_SECRET_STORE,
  activitySource: AWS_ACTIVITY_SOURCE,
  logSource: AWS_LOG_SOURCE,
  requestLogSource: ALB_REQUEST_LOG_SOURCE,
  databaseActivitySource: RDS_ACTIVITY_SOURCE,
  metricSource: AWS_METRIC_SOURCE,
  experimentSource: AWS_EXPERIMENT_SOURCE,
  costSource: AWS_COST_SOURCE,
  deploymentSource: AWS_DEPLOYMENT_SOURCE,
  parseCredentials: parseAwsKey,
  credentialHint: keyHint,
  isValidRegion: isAwsRegion,
  checkCredentials: checkAwsKey,
  failureMessage: collectorErrorMessage,
  actionFailureMessage: actionErrorMessage,
  buildMap: buildAwsMap,
};

export const awsProvider = defineProvider(awsProviderOf);
