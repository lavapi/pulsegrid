import { TriangleAlert } from 'lucide-react';

export function PipelineIssues({ issues }: { issues: string[] }) {
  return issues.map((issue) => (
    <p
      className="flex items-center gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-[13px] text-warning"
      role="status"
      key={issue}
    >
      <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
      {issue}
    </p>
  ));
}
