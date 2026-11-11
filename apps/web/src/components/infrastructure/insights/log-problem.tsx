import type { LogProblem } from '@pulsegrid/shared';
import { CopyButton } from '@/components/ui/copy-button';

/** Why logs can't be read, and the exact identity to grant when a bucket refused it. */
export function LogProblemNotice({ problem }: { problem: LogProblem }) {
  return (
    <div role="alert" className="flex flex-col gap-2 px-5 py-4 text-[13px]">
      <p className="text-warning">{problem.message}</p>
      {problem.principal && (
        <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
          Grant it to
          <code className="break-all rounded bg-muted px-1.5 py-0.5 text-foreground">{problem.principal}</code>
          <CopyButton value={problem.principal} label="Copy ARN" />
        </p>
      )}
    </div>
  );
}
