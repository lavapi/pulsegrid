import type { DatabaseAccessConnect } from '@pulsegrid/shared';
import { CopyButton } from '@/components/ui/copy-button';
import { connectSteps } from '@/lib/database-access';

/** The steps to send the person, with commands ready to copy. */
export function ConnectInstructions({ connect }: { connect: DatabaseAccessConnect }) {
  const steps = connectSteps(connect);
  const all = steps
    .map(({ title, text, command }, index) => [`${index + 1}. ${title}`, text, command].filter(Boolean).join('\n'))
    .join('\n\n');
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground">Send these steps to the person.</p>
        <CopyButton value={all} label="Copy all steps" />
      </div>
      <ol className="flex flex-col gap-3">
        {steps.map(({ title, text, command }, index) => (
          <li key={title} className="flex flex-col gap-1.5">
            <strong>
              {index + 1}. {title}
            </strong>
            {text && <span className="text-muted-foreground">{text}</span>}
            {command && (
              <div className="flex items-start gap-2 rounded-lg bg-muted p-3">
                <code className="min-w-0 flex-1 whitespace-pre-wrap font-mono text-xs [overflow-wrap:anywhere]">
                  {command}
                </code>
                <CopyButton value={command} label="Copy command" />
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
