import type { CredentialCheck } from '@pulsegrid/shared';
import { Check, TriangleAlert, X } from 'lucide-react';

export function CredentialResult({
  result,
  accountLabel,
}: {
  result: CredentialCheck;
  accountLabel: string;
}) {
  const blocked = result.services.filter(({ readable }) => !readable);
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 text-[13px]" role="status">
      <p className="font-medium">
        Connected to {accountLabel} {result.accountId}
      </p>
      <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3">
        {result.services.map(({ service, label, readable }) => (
          <li className="flex items-center gap-1.5" key={service}>
            {readable ? (
              <Check className="size-3.5 text-success" aria-hidden="true" />
            ) : (
              <X className="size-3.5 text-danger" aria-hidden="true" />
            )}
            {label}
            <span className="sr-only">{readable ? 'readable' : 'not readable'}</span>
          </li>
        ))}
      </ul>
      {blocked.length > 0 && (
        <p className="text-muted-foreground">
          Services these credentials can&apos;t read will be missing from the dashboard.
        </p>
      )}
      {result.missingActions && result.missingActions.length > 0 && (
        <MissingActions actions={result.missingActions} />
      )}
      {result.canWrite && <WriteAccessWarning />}
    </div>
  );
}

export function WriteAccessWarning() {
  return (
    <p className="flex items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning">
      <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
      These credentials can do more than PulseGrid needs. Limit them to the policy below.
    </p>
  );
}

function MissingActions({ actions }: { actions: readonly string[] }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning">
      <p className="flex items-center gap-2">
        <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
        These credentials are missing {actions.length} actions from the policy below. Pages and actions that need
        them won&apos;t work.
      </p>
      <p className="font-mono text-[12px] break-words">{actions.join(', ')}</p>
    </div>
  );
}
