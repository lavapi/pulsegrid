'use client';

import type { ProductionRelease, ProductionReleaseChoice } from '@pulsegrid/shared';
import { useRefreshingAction } from '@/components/use-refreshing-action';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { apiSend } from '@/lib/browser-api';

function ComponentList({ release }: { release: ProductionRelease }) {
  return (
    <ul className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-3 font-mono text-xs">
      {release.components.map(({ name, tag }) => (
        <li key={name}>
          {name} <span className="text-muted-foreground">→</span> {tag}
        </li>
      ))}
    </ul>
  );
}

/** Finish or roll back the release waiting in its hold; each asks first, naming what it changes. */
export function DecisionButtons({ release }: { release: ProductionRelease }) {
  const { pending, run } = useRefreshingAction();

  const decide = (decision: ProductionReleaseChoice, success: string) =>
    run(() => apiSend('/production-releases/decide', 'POST', { decision }), success);

  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmButton
        label="Finish release"
        triggerVariant="primary"
        title={`Finish release ${release.id}?`}
        description="Players stay on these versions, the old versions are retired after the bake, and the release finishes."
        details={<ComponentList release={release} />}
        confirmLabel="Finish release"
        confirmVariant="primary"
        disabled={pending}
        onConfirm={() => decide('finish', 'Release finishing. It moves on within about a minute.')}
      />
      <ConfirmButton
        label="Roll back"
        triggerVariant="danger"
        title={`Roll back release ${release.id}?`}
        description="Every service goes back to its old version. Players move back within a few minutes."
        details={<ComponentList release={release} />}
        confirmLabel="Roll back"
        disabled={pending}
        onConfirm={() => decide('rollback', 'Rolling back. It starts within about a minute.')}
      />
    </div>
  );
}
