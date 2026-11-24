import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AWS_POLICY, AWS_READ_ONLY_ACTIONS } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { connectionHint, parseAwsConnection, roleParts } from './aws-key';

describe('connectionHint', () => {
  it("names a role, never its External ID", () => {
    const hint = connectionHint({ roleArn: 'arn:aws:iam::123456789012:role/ops/PulseGridAccess', externalId: 'pulsegrid-x' });
    expect(hint).toBe('Role PulseGridAccess');
  });
});

describe('AWS_READ_ONLY_ACTIONS', () => {
  it('only reads', () => {
    for (const action of AWS_READ_ONLY_ACTIONS) {
      expect(action).toMatch(/:(List|Describe|FilterLogEvents|GetMetricData|GetExperiment|LookupEvents|GetBucketLocation|GetBucketTagging|GetCostAndUsage|SimulatePrincipalPolicy|DescribeAlarms|GetResourceMetrics)/);
      expect(action).not.toContain('*');
    }
  });
});

describe('parseAwsConnection', () => {
  const externalId = 'pulsegrid-abc123';
  const roleArn = 'arn:aws:iam::123456789012:role/PulseGridAccess';

  it('accepts a role with its External ID', () => {
    expect(parseAwsConnection({ roleArn: ` ${roleArn} `, externalId })).toEqual({ roleArn, externalId });
  });

  it('refuses access keys and anything that only looks like a role', () => {
    const secretAccessKey = 'abcdEFGHijklMNOPqrstUVWXyz0123456789+/AB';
    expect(parseAwsConnection({ accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey, externalId })).toBeNull();
    expect(parseAwsConnection({ roleArn: 'arn:aws:iam::123456789012:user/someone', externalId })).toBeNull();
    expect(parseAwsConnection({ roleArn })).toBeNull();
  });

  it("reads a role ARN's account and name, paths included", () => {
    expect(roleParts('arn:aws:iam::123456789012:role/ops/PulseGridAccess')).toEqual({
      accountId: '123456789012',
      name: 'PulseGridAccess',
    });
  });
});

describe('the PulseGrid policy in the docs', () => {
  it('matches the policy the app shows', () => {
    const docs = readFileSync(join(__dirname, '../../../../../../docs/connect-aws-account.md'), 'utf8');
    const section = docs.slice(docs.indexOf('## The PulseGrid policy'));
    const documented = /```json\n([\s\S]*?)\n```/.exec(section)?.[1];
    expect(JSON.parse(documented ?? '{}')).toEqual(JSON.parse(AWS_POLICY));
  });
});
