import { Card, CardHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';

/** Where PulseGrid calls AWS from, so each key can be locked to it. */
export function OutboundAddressCard({ address }: { address: string | null }) {
  return (
    <Card>
      <CardHeader
        title="Lock keys to PulseGrid"
        description="A key that only works from PulseGrid is useless to anyone who copies it."
      />
      <div className="flex flex-col gap-2 p-5 text-[13px]">
        {address ? (
          <p className="flex flex-wrap items-center gap-1.5">
            PulseGrid calls AWS from
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{address}</code>
            <CopyButton value={address} label="Copy address" />
          </p>
        ) : (
          <p className="text-muted-foreground">PulseGrid couldn&apos;t find the address it calls AWS from right now.</p>
        )}
        <p className="text-muted-foreground">
          Add a statement that denies every call from anywhere else to each key&apos;s IAM policy. If PulseGrid reaches S3
          through a VPC endpoint, allow its VPC too. See{' '}
          <a
            className="font-medium text-foreground hover:underline"
            href="https://github.com/lavapi/pulsegrid/blob/main/docs/connect-aws-account.md#lock-keys-to-pulsegrid"
            target="_blank"
            rel="noreferrer"
          >
            Lock keys to PulseGrid
          </a>
          .
        </p>
      </div>
    </Card>
  );
}
