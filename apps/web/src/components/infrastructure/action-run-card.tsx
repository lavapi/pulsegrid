import type { ActionRun } from '@pulsegrid/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { ActionStatusLine, startedByLabel, STATUS_VIEWS } from './action-status';

export function ActionRunCard({ run }: { run: ActionRun }) {
  const { label, tone } = STATUS_VIEWS[run.status];
  return (
    <Card>
      <CardHeader
        title={run.title}
        description={startedByLabel(run)}
        action={<Badge tone={tone}>{label}</Badge>}
      />
      <ActionStatusLine run={run} className="p-5" />
    </Card>
  );
}
