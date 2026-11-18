/** A production release step that failed, with a sentence a person can act on. Never raw AWS text. */
export class ProductionReleaseError extends Error {
  override readonly name = 'ProductionReleaseError';
}

export const MESSAGES = {
  notSetUp: "Production releases aren't set up in PulseGrid yet.",
  noRelease: 'There is no production release in progress.',
  notWaiting: 'This release is no longer waiting for a decision.',
  alreadyDecided: (by: string | null) =>
    by ? `This release was already decided by ${by}.` : 'Someone already decided on this release.',
  cantRead: "PulseGrid couldn't read the production release right now. Try again in a minute.",
  cantDecide:
    "PulseGrid couldn't record the decision. Try again, or use the Release production workflow in GitHub.",
} as const;

/** What the decide function's refusal means, matched loosely since its wording may change. */
export const refusalMessage = (functionMessage: string | undefined): string => {
  const text = functionMessage?.toLowerCase() ?? '';
  if (/no release|not in progress|no active/.test(text)) return MESSAGES.noRelease;
  if (/already decided|already been decided|decision already/.test(text)) return MESSAGES.alreadyDecided(null);
  if (/not in hold|not waiting|not holding|status/.test(text)) return MESSAGES.notWaiting;
  return MESSAGES.cantDecide;
};
