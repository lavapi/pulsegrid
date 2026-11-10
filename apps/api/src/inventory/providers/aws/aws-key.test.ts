import { AWS_READ_ONLY_ACTIONS } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { keyErrorMessage } from './aws-error-messages';
import { isRootArn, keyHint, parseAwsKey } from './aws-key';

describe('keyHint', () => {
  it('never shows the middle of the key or the secret', () => {
    const hint = keyHint({ accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'secret' });
    expect(hint).toBe('AKIA…MNOP');
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
      expect(action).toMatch(/:(List|Describe|FilterLogEvents|GetMetricData|GetExperiment|LookupEvents|GetBucketLocation|GetBucketTagging|GetCostAndUsage|SimulatePrincipalPolicy)/);
      expect(action).not.toContain('*');
    }
  });
});

describe('parseAwsKey', () => {
  const secretAccessKey = 'abcdEFGHijklMNOPqrstUVWXyz0123456789+/AB';

  it('accepts a long-term key', () => {
    expect(parseAwsKey({ accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey })).not.toBeNull();
  });

  it('refuses temporary keys and short secrets', () => {
    expect(parseAwsKey({ accessKeyId: 'ASIAABCDEFGHIJKLMNOP', secretAccessKey })).toBeNull();
    expect(parseAwsKey({ accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'short' })).toBeNull();
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
