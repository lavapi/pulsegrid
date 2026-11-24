import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AWS_POLICY, AWS_READ_ONLY_ACTIONS } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { keyErrorMessage } from './aws-error-messages';
import { connectionHint, isAwsRole, isRootArn, parseAwsConnection, roleParts } from './aws-key';

describe('connectionHint', () => {
  it('never shows the middle of the key or the secret', () => {
    const hint = connectionHint({ accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'secret' });
    expect(hint).toBe('AKIA…MNOP');
  });

  it("names a role, never its External ID", () => {
    const hint = connectionHint({ roleArn: 'arn:aws:iam::123456789012:role/ops/PulseGridAccess', externalId: 'pulsegrid-x' });
    expect(hint).toBe('Role PulseGridAccess');
  });
});

describe('isRootArn', () => {
  it('spots the root user', () => {
    expect(isRootArn('arn:aws:iam::123456789012:root')).toBe(true);
    expect(isRootArn('arn:aws:iam::123456789012:user/dashops')).toBe(false);
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
  const secretAccessKey = 'abcdEFGHijklMNOPqrstUVWXyz0123456789+/AB';
  const externalId = 'pulsegrid-abc123';

  it('accepts a long-term key', () => {
    const key = parseAwsConnection({ accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey, externalId });
    expect(key).toEqual({ accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey });
  });

  it('refuses temporary keys and short secrets', () => {
    expect(parseAwsConnection({ accessKeyId: 'ASIAABCDEFGHIJKLMNOP', secretAccessKey })).toBeNull();
    expect(parseAwsConnection({ accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'short' })).toBeNull();
  });

  it('accepts a role with its External ID, and nothing that only looks like one', () => {
    const roleArn = 'arn:aws:iam::123456789012:role/PulseGridAccess';
    const role = parseAwsConnection({ roleArn: ` ${roleArn} `, externalId });
    expect(role).toEqual({ roleArn, externalId });
    expect(role && isAwsRole(role)).toBe(true);
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

describe('keyErrorMessage', () => {
  const failure = (name: string) => Object.assign(new Error('raw aws text'), { name });

  it('explains a rejected key without raw AWS text', () => {
    expect(keyErrorMessage(failure('InvalidClientTokenId'))).toContain('Access Key ID');
    expect(keyErrorMessage(failure('SignatureDoesNotMatch'))).toContain('Secret Access Key');
    expect(keyErrorMessage(failure('Throttling'))).toBe("We couldn't reach AWS. Please try again.");
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
