import {
  FisClient,
  GetExperimentCommand,
  GetExperimentTemplateCommand,
  ListExperimentResolvedTargetsCommand,
  ListExperimentsCommand,
  ListExperimentTemplatesCommand,
  StartExperimentCommand,
  StopExperimentCommand,
} from '@aws-sdk/client-fis';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { AWS_EXPERIMENT_SOURCE } from './aws-fis';

const fis = mockClient(FisClient);
const context = { credentials: { accessKeyId: 'a', secretAccessKey: 'b' }, region: 'eu-central-1' };
const ALARM = 'arn:aws:cloudwatch:eu-central-1:111111111111:alarm:staging-errors';

const template = {
  id: 'EXT1',
  description: 'Reboot staging database',
  tags: { Name: 'Database failover' },
  targets: {
    Databases: { resourceType: 'aws:rds:db', resourceTags: { Env: 'staging' }, selectionMode: 'COUNT(1)' },
    Listed: { resourceType: 'aws:rds:db', resourceArns: ['arn:aws:rds:eu-central-1:111111111111:db:db-1'], selectionMode: 'ALL' },
  },
  actions: {
    Reboot: { actionId: 'aws:rds:reboot-db-instances', description: 'Reboot', parameters: { duration: 'PT5M' } },
  },
  stopConditions: [{ source: 'aws:cloudwatch:alarm', value: ALARM }],
};

beforeEach(() => fis.reset());

describe('AWS_EXPERIMENT_SOURCE', () => {
  it('describes templates in plain words', async () => {
    fis.on(ListExperimentTemplatesCommand).resolves({ experimentTemplates: [{ id: 'EXT1' }] });
    fis.on(GetExperimentTemplateCommand).resolves({ experimentTemplate: template });
    const [result] = await AWS_EXPERIMENT_SOURCE.listTemplates(context);
    expect(result).toEqual({
      id: 'EXT1',
      region: 'eu-central-1',
      label: 'Database failover',
      description: 'Reboot staging database',
      targets: [
        { name: 'Databases', resourceType: 'aws:rds:db', selection: 'tagged Env=staging, 1 of them', resourceIds: [] },
        {
          name: 'Listed',
          resourceType: 'aws:rds:db',
          selection: '1 listed resource',
          resourceIds: ['arn:aws:rds:eu-central-1:111111111111:db:db-1'],
        },
      ],
      steps: [{ name: 'Reboot', actionId: 'aws:rds:reboot-db-instances', description: 'Reboot', duration: 'PT5M' }],
      stopAlarms: ['staging-errors'],
    });
  });

  it('lists recent experiments with their state', async () => {
    fis.on(ListExperimentsCommand).resolves({
      experiments: [
        { id: 'EXP1', experimentTemplateId: 'EXT1', state: { status: 'running' }, creationTime: new Date('2026-11-10T12:00:00Z') },
        { id: 'EXP0', experimentTemplateId: 'EXT1', state: { status: 'unexpected' as 'running' } },
      ],
    });
    const experiments = await AWS_EXPERIMENT_SOURCE.listExperiments(context);
    expect(experiments.map(({ id, state, startedAt }) => ({ id, state, startedAt }))).toEqual([
      { id: 'EXP1', state: 'running', startedAt: '2026-11-10T12:00:00.000Z' },
      { id: 'EXP0', state: 'pending', startedAt: null },
    ]);
  });

  it('reads an experiment with its steps and the resources it picked', async () => {
    fis.on(GetExperimentCommand).resolves({
      experiment: {
        id: 'EXP1',
        experimentTemplateId: 'EXT1',
        state: { status: 'stopped', reason: 'Stop condition fired' },
        startTime: new Date('2026-11-10T12:00:00Z'),
        endTime: new Date('2026-11-10T12:03:00Z'),
        targets: template.targets,
        actions: {
          Reboot: {
            actionId: 'aws:rds:reboot-db-instances',
            parameters: { duration: 'PT5M' },
            state: { status: 'cancelled', reason: 'Stopped' },
            startTime: new Date('2026-11-10T12:00:10Z'),
          },
        },
        stopConditions: template.stopConditions,
      },
    });
    fis.on(GetExperimentTemplateCommand).resolves({ experimentTemplate: template });
    fis.on(ListExperimentResolvedTargetsCommand).resolves({
      resolvedTargets: [{ targetName: 'Databases', targetInformation: { identifier: 'arn:aws:rds:eu-central-1:111111111111:db:db-2', note: 'x' } }],
    });
    const record = await AWS_EXPERIMENT_SOURCE.getExperiment(context, 'EXP1');
    expect(record).toMatchObject({
      label: 'Database failover',
      description: 'Reboot staging database',
      state: 'stopped',
      reason: 'Stop condition fired',
      endedAt: '2026-11-10T12:03:00.000Z',
      steps: [{ name: 'Reboot', state: 'cancelled', reason: 'Stopped', duration: 'PT5M', startedAt: '2026-11-10T12:00:10.000Z', endedAt: null }],
      stopAlarms: ['staging-errors'],
      resolvedResourceIds: ['arn:aws:rds:eu-central-1:111111111111:db:db-2'],
    });
  });

  it('treats a missing experiment as gone', async () => {
    fis.on(GetExperimentCommand).rejects(Object.assign(new Error('x'), { name: 'ResourceNotFoundException' }));
    expect(await AWS_EXPERIMENT_SOURCE.getExperiment(context, 'EXP9')).toBeNull();
  });

  it('starts once per request token and stops by id', async () => {
    fis.on(StartExperimentCommand).resolves({ experiment: { id: 'EXP2' } });
    expect(await AWS_EXPERIMENT_SOURCE.start(context, 'EXT1', 'token-1')).toBe('EXP2');
    expect(fis.commandCalls(StartExperimentCommand)[0]?.args[0].input).toEqual({
      experimentTemplateId: 'EXT1',
      clientToken: 'token-1',
    });
    await AWS_EXPERIMENT_SOURCE.stop(context, 'EXP2');
    expect(fis.commandCalls(StopExperimentCommand)[0]?.args[0].input).toEqual({ id: 'EXP2' });
  });

  it('turns AWS errors into readable messages', () => {
    const named = (name: string) => Object.assign(new Error('raw'), { name });
    expect(AWS_EXPERIMENT_SOURCE.failureMessage(named('AccessDeniedException'))).toContain('FIS permissions');
    expect(AWS_EXPERIMENT_SOURCE.failureMessage(named('ServiceQuotaExceededException'))).toContain('as many experiments');
    expect(AWS_EXPERIMENT_SOURCE.failureMessage(named('Other'))).toBe("AWS couldn't complete that. Please try again.");
  });
});
