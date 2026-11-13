'use client';

import {
  type ConnectGuide as Guide,
  connectGuide,
  type DatabaseAccessConnect,
  type DatabaseAccessGrant,
  type GuideStep,
  guideAsText,
  guideForSlack,
} from '@pulsegrid/shared';
import { Share2 } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Time } from '@/components/ui/time';
import { canShare } from '@/lib/database-access';

function Code({ value }: { value: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-muted p-3">
      <code className="min-w-0 flex-1 whitespace-pre-wrap font-mono text-xs [overflow-wrap:anywhere]">{value}</code>
      <CopyButton value={value} label="Copy" />
    </div>
  );
}

function Step({ number, step }: { number: number; step: GuideStep }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <strong className="text-sm">{step.title}</strong>
        {step.text && <p className="text-[13px] text-muted-foreground">{step.text}</p>}
        {step.code && <Code value={step.code} />}
        {step.fields && (
          <dl className="divide-y rounded-lg border text-[13px]">
            {step.fields.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between gap-3 px-3 py-1.5">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="flex min-w-0 items-center gap-1 font-mono text-xs">
                  <span className="[overflow-wrap:anywhere]">{value}</span>
                  {label !== 'Password' && <CopyButton value={value} label={`Copy ${label}`} />}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </li>
  );
}

function ShareButton({ guide }: { guide: Guide }) {
  const [supported, setSupported] = useState(false);
  useEffect(() => setSupported(canShare(globalThis.navigator)), []);
  if (!supported) {
    return null;
  }
  const share = () => {
    void navigator.share({ title: guide.title, text: guideAsText(guide) }).catch(() => undefined);
  };
  return (
    <Button size="sm" onClick={share}>
      <Share2 aria-hidden="true" />
      Share…
    </Button>
  );
}

function GuideBody({ guide }: { guide: Guide }) {
  let number = 0;
  return (
    <div className="flex flex-col gap-5">
      {guide.sections.map((section) => (
        <section key={section.title} className="flex flex-col gap-3">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{section.title}</h3>
          <ol className="flex flex-col gap-4">
            {section.steps.map((step) => {
              number += 1;
              return <Step key={step.title} number={number} step={step} />;
            })}
          </ol>
          {section.notes && (
            <ul className="list-disc pl-5 text-[13px] text-muted-foreground">
              {section.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

/** The step-by-step guide for one grant, with buttons to send it to Slack or any messenger. */
export function ConnectGuide({
  grant,
  connect,
  trigger,
}: {
  grant: DatabaseAccessGrant;
  connect: DatabaseAccessConnect;
  trigger: ReactNode;
}) {
  const guide = connectGuide(connect, grant);
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogTitle className="text-base font-semibold">How to connect</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          Access for <strong className="text-foreground">{grant.userName}</strong> until{' '}
          <Time value={grant.expiresAt} withZone />.
        </DialogDescription>
        <div className="mt-4 flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
          <span className="text-[13px] text-muted-foreground">Send these steps to {grant.userName}:</span>
          <div className="flex flex-wrap gap-2">
            <CopyButton value={guideForSlack(guide)} label="Copy for Slack" showLabel />
            <CopyButton value={guideAsText(guide)} label="Copy as text" showLabel />
            <ShareButton guide={guide} />
          </div>
        </div>
        <div className="mt-5">
          <GuideBody guide={guide} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
