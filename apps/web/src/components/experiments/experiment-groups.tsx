import {
  type ExperimentGroup,
  type ExperimentRunSummary,
  type ExperimentsView,
  type ExperimentTemplate,
  templateKey,
} from '@pulsegrid/shared';
import Link from 'next/link';
import { DeleteGroupButton, RunExperimentsButton } from '@/components/experiments/experiment-buttons';
import { ExperimentGroupDialog } from '@/components/experiments/experiment-group-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Time } from '@/components/ui/time';
import { experimentRunPath } from '@/lib/experiments';

const labelsOf = (group: ExperimentGroup, templates: readonly ExperimentTemplate[]): string[] => {
  const labels = new Map(templates.map(({ id, region, label }) => [templateKey({ region, templateId: id }), label]));
  return group.templates.map((ref) => labels.get(templateKey(ref)) ?? ref.templateId);
};

const runOutcome = ({ started, failed }: ExperimentRunSummary): string =>
  failed === 0 ? `${started} started` : `${started} started · ${failed} didn't start`;

interface GroupsProps {
  accountId: string;
  view: ExperimentsView;
}

export function ExperimentGroups({ accountId, view }: GroupsProps) {
  const { templates, groups, access } = view;
  return (
    <Card>
      <CardHeader
        title="Groups"
        description="Start several templates at the same time, in one click."
        action={
          access.canRun &&
          templates.length > 0 && (
            <ExperimentGroupDialog
              accountId={accountId}
              templates={templates}
              trigger={<Button size="sm">New group</Button>}
            />
          )
        }
      />
      {groups.length === 0 ? (
        <p className="px-5 py-4 text-[13px] text-muted-foreground">No groups yet.</p>
      ) : (
        <ul className="divide-y">
          {groups.map((group) => {
            const labels = labelsOf(group, templates);
            return (
              <li key={group.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{group.name}</span>
                  <span className="text-[13px] text-muted-foreground">{labels.join(', ')}</span>
                </span>
                {access.canRun && (
                  <span className="flex items-center gap-2">
                    <DeleteGroupButton accountId={accountId} groupId={group.id} name={group.name} />
                    <ExperimentGroupDialog
                      accountId={accountId}
                      templates={templates}
                      group={group}
                      trigger={<Button size="sm">Edit</Button>}
                    />
                    <RunExperimentsButton
                      accountId={accountId}
                      groupId={group.id}
                      label={group.name}
                      templateLabels={labels}
                      triggerLabel="Run group"
                    />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function RecentRuns({ runs }: { runs: readonly ExperimentRunSummary[] }) {
  return (
    <Card>
      <CardHeader title="Recent group runs" description="Groups and Run all started here." />
      <ul className="divide-y">
        {runs.map((run) => (
          <li key={run.id}>
            <Link
              href={experimentRunPath(run.id)}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-muted"
            >
              <span className="flex flex-col">
                <span className="font-medium">{run.label}</span>
                <span className="text-[13px] text-muted-foreground">
                  <Time value={run.startedAt} />
                  {run.startedBy && ` · ${run.startedBy}`}
                </span>
              </span>
              <span className="text-[13px] text-muted-foreground">{runOutcome(run)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
