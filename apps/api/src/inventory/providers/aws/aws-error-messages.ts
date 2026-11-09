const ACCESS_DENIED_NAMES = new Set([
  'AccessDenied',
  'AccessDeniedException',
  'UnauthorizedOperation',
  'UnrecognizedClientException',
  'AuthorizationError',
  'AccessDeniedFault',
]);

const REJECTED_KEY_MESSAGES: Record<string, string> = {
  InvalidClientTokenId: "AWS doesn't recognize this access key. Check the Access Key ID.",
  SignatureDoesNotMatch: "The secret doesn't match this access key. Check the Secret Access Key.",
};

const ACTION_MESSAGES: Record<string, string> = {
  InvalidDBInstanceStateFault: "This database can't be rebooted in its current state.",
  InvalidDBInstanceState: "This database can't be rebooted in its current state.",
  InvalidCacheClusterStateFault: "This cache can't be rebooted in its current state.",
  InvalidParameterCombinationException: "AWS doesn't support rebooting this cache. Caches in cluster mode can't be rebooted.",
  InvalidParameterValueException: "AWS doesn't support rebooting this cache. Caches in cluster mode can't be rebooted.",
  ServiceNotActiveException: "This service isn't active.",
  ClusterNotFoundException: "We couldn't find this service's cluster. Sync the account and try again.",
  ServiceNotFoundException: "We couldn't find this service. Sync the account and try again.",
  ResourceNotFoundException: "This secret has no value yet, or it no longer exists.",
  DecryptionFailure: "This key can't decrypt the secret. Allow it on the secret's KMS key.",
  EncryptionFailure: "This key can't encrypt the secret. Allow it on the secret's KMS key.",
  InvalidRequestException: "AWS can't change this secret right now. It may be scheduled for deletion.",
  InvalidParameterException: 'This secret is too large for AWS to store.',
};

const errorName = (error: unknown): string => (error as { name?: string }).name ?? '';

export const isAccessDenied = (error: unknown): boolean => ACCESS_DENIED_NAMES.has(errorName(error));

export const keyErrorMessage = (error: unknown): string =>
  REJECTED_KEY_MESSAGES[errorName(error)] ?? "We couldn't reach AWS. Please try again.";

export const actionErrorMessage = (error: unknown): string =>
  isAccessDenied(error)
    ? "This key doesn't allow that. Add the action permissions to its IAM policy."
    : (ACTION_MESSAGES[errorName(error)] ?? "AWS couldn't complete that. Please try again.");

export const collectorErrorMessage = (error: unknown, label: string): string =>
  isAccessDenied(error)
    ? `This key does not have permission to read ${label}. Check its IAM policy.`
    : `We could not read ${label}. We will try again at the next sync.`;
