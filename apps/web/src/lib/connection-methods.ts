import type { ConnectionMethod, CredentialKind } from '@pulsegrid/shared';

const OLD_KEY_NOTE = 'PulseGrid deletes the stored key once the role works. Delete the access key in IAM too.';
const SAME_ACCOUNT_NOTE = 'It must belong to the same account. Delete the old one with your provider afterwards.';

/** What a connected account can change to: a new one of its kind, and a role when it still uses a key. */
export const replacementMethods = (
  current: CredentialKind,
  methods: readonly ConnectionMethod[],
): ConnectionMethod[] => {
  const same = methods.filter(({ id }) => id === current);
  const role = current === 'key' ? methods.filter(({ id }) => id === 'role') : [];
  return [...role, ...same];
};

/** The button and dialog wording for changing an account's connection to this method. */
export const replacementText = (
  current: CredentialKind,
  method: ConnectionMethod,
  accountName: string,
): { label: string; description: string; success: string } => {
  const kind = method.label.toLowerCase();
  const switching = current !== method.id;
  return {
    label: switching ? `Switch to a ${kind}` : `Replace ${kind}`,
    description: `${method.description} ${switching ? OLD_KEY_NOTE : SAME_ACCOUNT_NOTE}`,
    success: switching ? `${accountName} now uses a ${kind}` : `${method.label} replaced`,
  };
};
