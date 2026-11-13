/** A database access step that failed, with a message a person can read and act on. Never raw AWS text. */
export class DatabaseAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseAccessError';
  }
}

export const MESSAGES = {
  notAllowed: "This person isn't in the ProductionDatabaseAccess group. Ask an admin to add them in Identity Center.",
  userNotFound: "There's no one with that user name in IAM Identity Center. Check it; it's usually their email.",
  badExpiry: "That end time isn't allowed: access can last from 1 minute to 8 hours.",
  retry: "AWS couldn't finish this. Try again in a minute.",
  throttled: 'AWS is busy right now. Try again in a minute.',
  keyNotAllowed:
    "The Production account's key isn't allowed to run the database access workflows. Add the statement from docs/database-access.md to its IAM policy.",
  noKey: 'The Production account has no access key in PulseGrid. Add one under Integrations.',
} as const;

/** What each error code the workflows end with means for the person granting access. */
const WORKFLOW_ERRORS: Record<string, string> = {
  NotAllowed: MESSAGES.notAllowed,
  UserNotFound: MESSAGES.userNotFound,
  BadExpiry: MESSAGES.badExpiry,
};

const THROTTLED = /Throttl|TooManyRequests|RateExceeded|LimitExceeded/;
const ACCESS_DENIED = new Set([
  'AccessDenied',
  'AccessDeniedException',
  'UnauthorizedOperation',
  'UnrecognizedClientException',
]);

/** The message for a workflow run that ended in an error code; anything unexpected asks to try again. */
export const workflowFailure = (code: string | null | undefined): string =>
  (code && WORKFLOW_ERRORS[code]) || MESSAGES.retry;

/** Turns a failed AWS call into a readable error; errors that are already readable pass through. */
export const readable = (error: unknown): DatabaseAccessError => {
  if (error instanceof DatabaseAccessError) {
    return error;
  }
  const name = (error as { name?: string }).name ?? '';
  if (ACCESS_DENIED.has(name)) {
    return new DatabaseAccessError(MESSAGES.keyNotAllowed);
  }
  return new DatabaseAccessError(THROTTLED.test(name) ? MESSAGES.throttled : MESSAGES.retry);
};
