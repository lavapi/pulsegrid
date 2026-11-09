import type { ProviderSetup } from '@pulsegrid/shared';
import { Card, CardHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';

export function ProviderSetupCard({ setup }: { setup: ProviderSetup }) {
  return (
    <Card>
      <CardHeader
        title={setup.title}
        description={setup.description}
        action={<CopyButton value={setup.code} label="Copy" />}
      />
      <pre className="max-h-72 overflow-auto p-5 text-xs">{setup.code}</pre>
    </Card>
  );
}
