'use client';

import type { PipelineActionAccess, PipelineInput, PipelineRunOptions } from '@pulsegrid/shared';
import { Play } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dropdown } from '@/components/ui/dropdown';
import { Field, Input } from '@/components/ui/input';
import { ActionDialog } from './action-dialog';
import { usePipelineAction } from './use-pipeline-action';

interface RunPipelineButtonProps {
  appId: string;
  repository: string;
  workflowId: string;
  name: string;
  options: PipelineRunOptions;
}

const initialValues = (inputs: PipelineInput[]): Record<string, string> =>
  Object.fromEntries(inputs.map(({ name, defaultValue }) => [name, defaultValue ?? '']));

function InputField({
  input,
  value,
  onChange,
}: {
  input: PipelineInput;
  value: string;
  onChange: (value: string) => void;
}) {
  const label = input.required ? `${input.name} (required)` : input.name;
  const hint = input.description ?? undefined;
  const dropdownOptions =
    input.type === 'boolean'
      ? ['true', 'false']
      : input.type === 'choice'
        ? input.options
        : null;

  if (dropdownOptions) {
    return (
      <Field label={label} {...(hint ? { hint } : {})} labelsOwnControl>
        <Dropdown
          label={input.name}
          value={value}
          onValueChange={onChange}
          options={[
            ...(input.required ? [] : [{ value: '', label: 'Not set' }]),
            ...dropdownOptions.map((option) => ({ value: option, label: option })),
          ]}
        />
      </Field>
    );
  }
  return (
    <Field label={label} {...(hint ? { hint } : {})}>
      <Input
        value={value}
        required={input.required}
        type={input.type === 'number' ? 'number' : 'text'}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

const accessForBranch = (
  { access, branchAccess }: PipelineRunOptions,
  branch: string,
): PipelineActionAccess => {
  if (!branchAccess) {
    return access;
  }
  return branch === branchAccess.branch ? branchAccess.matched : branchAccess.otherwise;
};

export function RunPipelineButton({
  appId,
  repository,
  workflowId,
  name,
  options,
}: RunPipelineButtonProps) {
  const { pending, send } = usePipelineAction();
  const [branch, setBranch] = useState(options.defaultBranch);
  const [values, setValues] = useState(() => initialValues(options.definition.inputs));
  const access = accessForBranch(options, branch);

  return (
    <ActionDialog
      trigger={
        <Button variant="primary" disabled={pending}>
          <Play />
          Run pipeline
        </Button>
      }
      title={`Run ${name}`}
      description={`This starts a new run in ${repository}.`}
      confirmLabel="Run pipeline"
      blockedReason={access.reason}
      pending={pending}
      onConfirm={() =>
        send(
          '/pipelines/runs',
          {
            appId,
            workflowId,
            branch,
            inputs: Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '')),
          },
          'Pipeline started',
        )
      }
    >
      <Field label="Branch" labelsOwnControl>
        <Dropdown
          label="Branch"
          value={branch}
          onValueChange={setBranch}
          options={options.branches.map((item) => ({ value: item, label: item }))}
        />
      </Field>
      {options.definition.inputs.map((input) => (
        <InputField
          key={input.name}
          input={input}
          value={values[input.name] ?? ''}
          onChange={(value) => setValues({ ...values, [input.name]: value })}
        />
      ))}
    </ActionDialog>
  );
}
