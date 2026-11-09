'use client';

import { formatJsonText, isJsonText, type SecretContent, type SecretView } from '@pulsegrid/shared';
import { Eye, EyeOff, Pencil, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ActionDialog } from '@/components/pipelines/action-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { apiSend, apiSendForJson } from '@/lib/browser-api';

const HIDE_AFTER_MS = 30_000;
const MASK = '••••••••';
const REDEPLOY_REMINDER = 'Saved. Force deploy the services that use this secret, and update anything that reads a renamed key.';
const TEXT_LABEL = 'Value';
const PLAIN_ROWS = 4;
const JSON_ROWS = 18;
const FULL_SECRET_LABEL = 'Full secret';
const SECRET_LAYOUTS = [
  { id: 'json', label: 'JSON' },
  { id: 'keys', label: 'Keys' },
] as const;

type SecretLayout = (typeof SECRET_LAYOUTS)[number]['id'];

interface SecretActions {
  pending: boolean;
  reveal: (key: string | null) => Promise<string | null>;
  save: (key: string | null, name: string | null, value: string) => void;
  remove: (key: string) => void;
}

function AddKeyDialog({ actions }: { actions: SecretActions }) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');

  return (
    <ActionDialog
      trigger={<Button size="sm">Add key</Button>}
      title="Add a key"
      description="Add a new key to this secret."
      confirmLabel="Add key"
      canConfirm={name.trim() !== ''}
      pending={actions.pending}
      onConfirm={() => {
        actions.save(null, name.trim(), value);
        setName('');
        setValue('');
      }}
    >
      <Field label="Key">
        <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
      </Field>
      <Field label="Value">
        <Textarea
          rows={PLAIN_ROWS}
          className="font-mono"
          value={value}
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
        />
      </Field>
    </ActionDialog>
  );
}

function EditDialog({
  label,
  buttonLabel,
  secretKey,
  actions,
}: {
  label: string;
  buttonLabel: string;
  secretKey: string | null;
  actions: SecretActions;
}) {
  const [name, setName] = useState(secretKey ?? '');
  const [value, setValue] = useState('');
  const [original, setOriginal] = useState<string | null>(null);
  const isJson = original !== null && isJsonText(original);
  const validJson = !isJson || isJsonText(value);

  const load = async (open: boolean) => {
    setOriginal(null);
    setName(secretKey ?? '');
    if (!open) {
      return;
    }
    const current = await actions.reveal(secretKey);
    if (current !== null) {
      setOriginal(current);
      setValue(formatJsonText(current));
    }
  };

  return (
    <ActionDialog
      trigger={
        <Button variant="ghost" size="sm" aria-label={`${buttonLabel} ${label}`}>
          <Pencil />
          {buttonLabel}
        </Button>
      }
      title={`Edit ${secretKey === null ? 'secret' : label}`}
      description={
        secretKey === null
          ? 'What you save replaces the current value.'
          : 'Change the key, the value or both. Anything that reads the old key name needs updating too.'
      }
      confirmLabel="Save"
      wide={isJson}
      canConfirm={original !== null && (secretKey === null || name.trim() !== '')}
      blockedReason={validJson ? null : "This isn't valid JSON."}
      pending={actions.pending}
      onOpenChange={load}
      onConfirm={() => actions.save(secretKey, secretKey === null ? null : name.trim(), value)}
    >
      {secretKey !== null && (
        <Field label="Key">
          <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
        </Field>
      )}
      <Field label={isJson ? 'Value (JSON)' : 'Value'}>
        <Textarea
          rows={isJson ? JSON_ROWS : PLAIN_ROWS}
          className="font-mono text-[13px]"
          value={value}
          disabled={original === null}
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
        />
      </Field>
      {isJson && (
        <Button
          type="button"
          size="sm"
          className="self-start"
          disabled={!validJson}
          onClick={() => setValue(formatJsonText(value))}
        >
          Format
        </Button>
      )}
    </ActionDialog>
  );
}

function SecretRow({
  name,
  secretKey,
  canWrite,
  actions,
  showLabel = 'Show',
  editLabel = 'Edit',
}: {
  name: string;
  secretKey: string | null;
  canWrite: boolean;
  actions: SecretActions;
  showLabel?: string;
  editLabel?: string;
}) {
  const [shown, setShown] = useState<string | null>(null);
  const isJson = shown !== null && isJsonText(shown);

  useEffect(() => {
    if (shown === null) {
      return;
    }
    const timer = setTimeout(() => setShown(null), HIDE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  const toggle = async () => {
    setShown(shown === null ? await actions.reveal(secretKey) : null);
  };

  return (
    <li className="grid items-center gap-2 px-5 py-2.5 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)_auto]">
      <code className="min-w-0 break-all text-[13px] font-medium">{name}</code>
      <code className="min-w-0 break-all text-[13px] text-muted-foreground">
        {isJson ? 'JSON' : (shown ?? MASK)}
      </code>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={actions.pending}
          aria-label={`${shown === null ? 'Show' : 'Hide'} ${name}`}
          onClick={toggle}
        >
          {shown === null ? <Eye /> : <EyeOff />}
          {shown === null ? showLabel : 'Hide'}
        </Button>
        {canWrite && (
          <EditDialog label={name} buttonLabel={editLabel} secretKey={secretKey} actions={actions} />
        )}
        {canWrite && secretKey !== null && (
          <ActionDialog
            trigger={
              <Button variant="dangerGhost" size="sm" aria-label={`Delete ${name}`}>
                <Trash2 />
                Delete
              </Button>
            }
            title={`Delete ${name}?`}
            description="This removes the key from the secret. AWS keeps the previous version for a short time."
            confirmLabel="Delete key"
            danger
            pending={actions.pending}
            onConfirm={() => actions.remove(secretKey)}
          />
        )}
      </div>
      {isJson && (
        <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-3 text-[13px] sm:col-span-3">
          {formatJsonText(shown)}
        </pre>
      )}
    </li>
  );
}

function SecretRows({
  content,
  view,
  canWrite,
  actions,
}: {
  content: SecretContent;
  view: SecretLayout;
  canWrite: boolean;
  actions: SecretActions;
}) {
  if (content.format === 'binary') {
    return <p className="p-5 text-sm text-muted-foreground">Binary secrets can't be shown here.</p>;
  }
  if (content.format === 'text') {
    return (
      <ul className="divide-y">
        <SecretRow
          key={content.versionId}
          name={TEXT_LABEL}
          secretKey={null}
          canWrite={canWrite}
          actions={actions}
        />
      </ul>
    );
  }
  if (view === 'json') {
    return (
      <ul className="divide-y">
        <SecretRow
          key={content.versionId}
          name={FULL_SECRET_LABEL}
          secretKey={null}
          canWrite={canWrite}
          actions={actions}
          showLabel="Show all"
          editLabel="Edit JSON"
        />
      </ul>
    );
  }
  if (content.keys.length === 0) {
    return <p className="p-5 text-sm text-muted-foreground">This secret has no keys yet.</p>;
  }
  return (
    <ul className="divide-y">
      {content.keys.map((key) => (
        <SecretRow
          key={`${content.versionId}:${key}`}
          name={key}
          secretKey={key}
          canWrite={canWrite}
          actions={actions}
        />
      ))}
    </ul>
  );
}

export function SecretPanel({ resourceId, view }: { resourceId: string; view: SecretView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [layout, setLayout] = useState<SecretLayout>('json');
  const { access, content, error } = view;
  const hasKeys = content?.format === 'keyValue';
  const path = `/resources/${resourceId}/secret`;
  const versionId = content?.versionId ?? '';

  const finish = (failure: string | null) => {
    if (failure) {
      toast.error(failure);
      return;
    }
    setSaved(true);
    router.refresh();
  };

  const actions: SecretActions = {
    pending,
    reveal: async (key) => {
      const { data, error: failure } = await apiSendForJson<{ value: string }>(`${path}/reveal`, 'POST', {
        key,
      });
      if (failure) {
        toast.error(failure);
      }
      return data?.value ?? null;
    },
    save: (key, name, value) =>
      startTransition(async () => {
        finish(await apiSend(`${path}/keys`, 'PUT', { key, name, value, versionId }));
      }),
    remove: (key) =>
      startTransition(async () => {
        finish(await apiSend(`${path}/keys/delete`, 'POST', { key, versionId }));
      }),
  };

  return (
    <Card>
      <CardHeader
        title="Keys and values"
        {...(hasKeys
          ? {
              action: (
                <div className="flex items-center gap-2">
                  {access.canWrite && layout === 'keys' && <AddKeyDialog actions={actions} />}
                  <div className="flex rounded-lg border p-0.5" role="group" aria-label="Secret view">
                    {SECRET_LAYOUTS.map(({ id, label }) => (
                      <Button
                        key={id}
                        size="sm"
                        variant={layout === id ? 'secondary' : 'ghost'}
                        aria-pressed={layout === id}
                        onClick={() => setLayout(id)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>
              ),
            }
          : {})}
      />
      {saved && (
        <p className="border-b bg-warning-soft px-5 py-2.5 text-[13px] text-warning" role="status">
          {REDEPLOY_REMINDER}
        </p>
      )}
      {access.reason && <p className="px-5 py-4 text-sm text-muted-foreground">{access.reason}</p>}
      {error && <p className="p-5 text-sm text-danger">{error}</p>}
      {content && (
        <SecretRows content={content} view={layout} canWrite={access.canWrite} actions={actions} />
      )}
    </Card>
  );
}
