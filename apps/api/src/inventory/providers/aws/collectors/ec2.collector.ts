import { EC2Client, type Instance, paginateDescribeInstances } from '@aws-sdk/client-ec2';
import type { CollectedResource, ResourceCollector } from '../../provider';
import type { AwsKey } from '../aws-key';
import { collectPages, healthFrom, tagMap } from './helpers';

const toInstanceResource = (instance: Instance, region: string): CollectedResource => {
  const status = instance.State?.Name ?? 'unknown';
  const tags = tagMap(instance.Tags);
  const nativeId = instance.InstanceId ?? '';
  return {
    type: 'ec2-instance',
    region,
    nativeId,
    name: tags['Name'] ?? nativeId,
    status,
    health: healthFrom(status, {
      healthy: ['running'],
      stopped: ['stopped', 'stopping', 'shutting-down', 'terminated'],
    }),
    tags,
    details: {
      instanceType: instance.InstanceType,
      availabilityZone: instance.Placement?.AvailabilityZone,
      vpcId: instance.VpcId,
      subnetId: instance.SubnetId,
      securityGroups: instance.SecurityGroups?.flatMap(({ GroupId }) => GroupId ?? []),
      privateIp: instance.PrivateIpAddress,
      publicIp: instance.PublicIpAddress,
      launchedAt: instance.LaunchTime?.toISOString(),
    },
  };
};

export const ec2Collector: ResourceCollector<AwsKey> = {
  name: 'ec2',
  label: 'EC2',
  scope: 'regional',
  types: ['ec2-instance'],
  collect: async ({ credentials, region }) => {
    const client = new EC2Client({ region, credentials });
    const reservations = await collectPages(
      paginateDescribeInstances({ client }, {}),
      (page) => page.Reservations,
    );
    return reservations
      .flatMap((reservation) => reservation.Instances ?? [])
      .filter((instance) => instance.State?.Name !== 'terminated')
      .map((instance) => toInstanceResource(instance, region));
  },
};
