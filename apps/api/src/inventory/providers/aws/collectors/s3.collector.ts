import {
  type Bucket,
  GetBucketLocationCommand,
  GetBucketTaggingCommand,
  ListBucketsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { type CollectedResource, GLOBAL_REGION, type ResourceCollector } from '../../provider';
import type { AwsKey } from '../aws-key';
import { chunk } from '../../../../common/chunk';
import { safeTags, tagMap } from './helpers';

const LIST_REGION = 'us-east-1';
const LEGACY_DEFAULT_REGION = 'us-east-1';
const LOCATIONS_AT_ONCE = 20;

const bucketRegion = async (client: S3Client, name: string): Promise<string> => {
  try {
    const { LocationConstraint } = await client.send(new GetBucketLocationCommand({ Bucket: name }));
    return LocationConstraint || LEGACY_DEFAULT_REGION;
  } catch {
    return GLOBAL_REGION;
  }
};

const bucketTags = (client: S3Client, name: string): Promise<Record<string, string>> =>
  safeTags(async () => {
    const { TagSet } = await client.send(new GetBucketTaggingCommand({ Bucket: name }));
    return tagMap(TagSet);
  });

const toBucketResource = async (client: S3Client, bucket: Bucket): Promise<CollectedResource> => {
  const name = bucket.Name ?? '';
  return {
    type: 's3-bucket',
    region: await bucketRegion(client, name),
    nativeId: `arn:aws:s3:::${name}`,
    name,
    status: 'exists',
    health: 'healthy',
    tags: await bucketTags(client, name),
    details: { createdAt: bucket.CreationDate?.toISOString() },
  };
};

export const s3Collector: ResourceCollector<AwsKey> = {
  name: 's3',
  label: 'S3',
  scope: 'global',
  types: ['s3-bucket'],
  collect: async ({ credentials }) => {
    const client = new S3Client({
      region: LIST_REGION,
      credentials,
      followRegionRedirects: true,
    });
    const { Buckets = [] } = await client.send(new ListBucketsCommand({}));
    const resources: CollectedResource[] = [];
    for (const batch of chunk(Buckets, LOCATIONS_AT_ONCE)) {
      resources.push(...(await Promise.all(batch.map((item) => toBucketResource(client, item)))));
    }
    return resources;
  },
};
