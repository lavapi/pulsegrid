import { AWS_ROLE_NAME, awsRoleTrustPolicy, type RoleTrustDetails } from '@pulsegrid/shared';
import { CopyButton } from '@/components/ui/copy-button';

/** What to set on the role: this project's External ID and the trust policy that names PulseGrid. */
export function RoleTrustGuide({ trust }: { trust: RoleTrustDetails }) {
  const policy = awsRoleTrustPolicy(trust.externalId, trust.principals);
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4 text-[13px]">
      <p>
        In the account, create a role (we suggest <code className="font-mono">{AWS_ROLE_NAME}</code>) with the IAM policy
        below and this trust policy. Only PulseGrid can take it on, and only for this project.
      </p>
      <p className="flex flex-wrap items-center gap-1.5">
        External ID
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{trust.externalId}</code>
        <CopyButton value={trust.externalId} label="Copy External ID" />
      </p>
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center justify-between gap-2">
          Trust policy
          <CopyButton value={policy} label="Copy trust policy" showLabel />
        </span>
        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">{policy}</pre>
      </div>
    </div>
  );
}
