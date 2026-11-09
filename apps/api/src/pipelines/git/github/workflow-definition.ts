import type {
  PipelineDefinition,
  PipelineEnvironmentRule,
  PipelineInput,
  PipelineInputType,
} from '@pulsegrid/shared';
import { parse } from 'yaml';

const NO_DEFINITION: PipelineDefinition = {
  manual: false,
  inputs: [],
  environments: [],
  environmentRule: null,
  opaqueEnvironment: false,
};
const BRANCH_RULE =
  /^\$\{\{\s*github\.ref(?:_name)?\s*==\s*'(?:refs\/heads\/)?([^']+)'\s*&&\s*'([^']+)'\s*\|\|\s*'([^']+)'\s*\}\}$/;
const INPUT_TYPES: readonly PipelineInputType[] = [
  'string',
  'boolean',
  'choice',
  'number',
  'environment',
];
const EXPRESSION = '${{';

type YamlMap = Record<string, unknown>;

const isMap = (value: unknown): value is YamlMap =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const triggerOf = (document: YamlMap): { manual: boolean; inputs: YamlMap } => {
  const triggers = document['on'];
  if (typeof triggers === 'string') {
    return { manual: triggers === 'workflow_dispatch', inputs: {} };
  }
  if (Array.isArray(triggers)) {
    return { manual: triggers.includes('workflow_dispatch'), inputs: {} };
  }
  if (!isMap(triggers) || !('workflow_dispatch' in triggers)) {
    return { manual: false, inputs: {} };
  }
  const dispatch = triggers['workflow_dispatch'];
  const inputs = isMap(dispatch) ? dispatch['inputs'] : undefined;
  return { manual: true, inputs: isMap(inputs) ? inputs : {} };
};

const toInputType = (value: unknown): PipelineInputType =>
  INPUT_TYPES.find((type) => type === value) ?? 'string';

const toInput = (name: string, raw: unknown): PipelineInput => {
  const input = isMap(raw) ? raw : {};
  const fallback = input['default'];
  return {
    name,
    description: typeof input['description'] === 'string' ? input['description'] : null,
    required: input['required'] === true,
    type: toInputType(input['type']),
    defaultValue: fallback === undefined || fallback === null ? null : String(fallback),
    options: Array.isArray(input['options']) ? input['options'].map(String) : [],
  };
};

const rawEnvironment = (job: unknown): string | null => {
  if (!isMap(job)) {
    return null;
  }
  const environment = job['environment'];
  const name = isMap(environment) ? environment['name'] : environment;
  return typeof name === 'string' ? name.trim() : null;
};

const parseRule = (expression: string): PipelineEnvironmentRule | null => {
  const [, branch, matched, otherwise] = BRANCH_RULE.exec(expression) ?? [];
  return branch && matched && otherwise ? { branch, matched, otherwise } : null;
};

const readEnvironments = (
  jobs: unknown[],
): Pick<PipelineDefinition, 'environments' | 'environmentRule' | 'opaqueEnvironment'> => {
  const values = [...new Set(jobs.flatMap((job) => rawEnvironment(job) ?? []))];
  const plain = values.filter((value) => !value.includes(EXPRESSION));
  const expressions = values.filter((value) => value.includes(EXPRESSION));
  const rules = expressions.map(parseRule);
  const onlyRule = expressions.length === 1 ? rules[0] : null;
  return {
    environments: [
      ...new Set([...plain, ...(onlyRule ? [onlyRule.matched, onlyRule.otherwise] : [])]),
    ],
    environmentRule: onlyRule && plain.length === 0 ? onlyRule : null,
    opaqueEnvironment: expressions.length > 0 && !(onlyRule && plain.length === 0),
  };
};

export const parseWorkflowDefinition = (content: string): PipelineDefinition => {
  let document: unknown;
  try {
    document = parse(content);
  } catch {
    return NO_DEFINITION;
  }
  if (!isMap(document)) {
    return NO_DEFINITION;
  }
  const { manual, inputs } = triggerOf(document);
  const jobs = isMap(document['jobs']) ? Object.values(document['jobs']) : [];
  return {
    manual,
    inputs: Object.entries(inputs).map(([name, input]) => toInput(name, input)),
    ...readEnvironments(jobs),
  };
};
