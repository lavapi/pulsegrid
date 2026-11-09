'use client';

import { DOMAIN_KINDS, type DomainKind, type EnvironmentDomain, type EnvironmentWithDomains } from '@pulsegrid/shared';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { apiSend, apiSendForJson } from '@/lib/browser-api';
import { DOMAIN_GROUP_TITLES, domainHost, domainName, domainsOfKind } from '@/lib/domains';
import { DomainForm, type DomainFormValues } from './domain-form';
import { DomainIcon, ExternalDomainLink } from './domain-links';
import { useRefreshingAction } from './use-refreshing-action';

type Action = ReturnType<typeof useRefreshingAction>;

const send = (path: string, method: 'POST' | 'PUT', values: DomainFormValues) => async () =>
  (await apiSendForJson(path, method, values)).error;

function DomainRow({
  environment,
  domain,
  action: { pending, run },
}: {
  environment: EnvironmentWithDomains;
  domain: EnvironmentDomain;
  action: Action;
}) {
  const [editing, setEditing] = useState(false);
  const name = domainName(domain);

  if (editing) {
    return (
      <li className="rounded-lg border bg-card p-3">
        <DomainForm
          environmentName={environment.name}
          domain={domain}
          submitLabel="Save"
          pending={pending}
          onSubmit={(values) =>
            run(send(`/environments/domains/${domain.id}`, 'PUT', values), 'Domain saved', () => setEditing(false))
          }
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-2 text-[13px]">
      <DomainIcon kind={domain.kind} className="text-primary" />
      <span className="font-medium">{name}</span>
      <ExternalDomainLink domain={domain} className="min-w-0 truncate text-muted-foreground hover:underline">
        {domainHost(domain)}
      </ExternalDomainLink>
      <span className="ml-auto flex items-center gap-1">
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(true)} aria-label={`Edit ${name}`}>
          <Pencil aria-hidden="true" />
          Edit
        </Button>
        <ConfirmButton
          label="Remove"
          title={`Remove ${name}?`}
          description={`Its link disappears from ${environment.name}. The site itself isn't changed.`}
          confirmLabel="Remove domain"
          disabled={pending}
          onConfirm={() => run(() => apiSend(`/environments/domains/${domain.id}`, 'DELETE'), 'Domain removed')}
        />
      </span>
    </li>
  );
}

function DomainGroup({
  environment,
  kind,
  action,
}: {
  environment: EnvironmentWithDomains;
  kind: DomainKind;
  action: Action;
}) {
  const domains = domainsOfKind(environment.domains, kind);
  const title = DOMAIN_GROUP_TITLES[kind];
  return (
    <section className="flex flex-col gap-2" aria-label={`${title} for ${environment.name}`}>
      <h4 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <DomainIcon kind={kind} className="size-3.5" />
        {title}
      </h4>
      {domains.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {domains.map((domain) => (
            <DomainRow environment={environment} domain={domain} action={action} key={domain.id} />
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted-foreground">None yet.</p>
      )}
    </section>
  );
}

export function EnvironmentDomains({ environment }: { environment: EnvironmentWithDomains }) {
  const action = useRefreshingAction();

  return (
    <div className="flex flex-col gap-4 rounded-lg bg-muted/40 p-3">
      <span className="text-[13px] font-medium">Domains</span>
      <div className="grid gap-4 sm:grid-cols-2">
        {DOMAIN_KINDS.map((kind) => (
          <DomainGroup environment={environment} kind={kind} action={action} key={kind} />
        ))}
      </div>
      <div className="border-t pt-3">
        <DomainForm
          environmentName={environment.name}
          submitLabel="Add domain"
          pending={action.pending}
          onSubmit={(values, form) =>
            action.run(send(`/environments/${environment.id}/domains`, 'POST', values), 'Domain added', () =>
              form.reset(),
            )
          }
        />
      </div>
    </div>
  );
}
