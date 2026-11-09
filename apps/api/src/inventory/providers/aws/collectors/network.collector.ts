import {
  EC2Client,
  paginateDescribeRouteTables,
  paginateDescribeSecurityGroups,
  paginateDescribeSubnets,
  paginateDescribeVpcs,
  type RouteTable,
  type SecurityGroup,
  type Subnet,
  type Vpc,
} from '@aws-sdk/client-ec2';
import {
  ElasticLoadBalancingV2Client,
  DescribeTagsCommand,
  type LoadBalancer,
  paginateDescribeLoadBalancers,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import type { CollectedResource, ResourceCollector } from '../../provider';
import type { AwsKey } from '../aws-key';
import { chunk } from '../../../../common/chunk';
import { collectPages, healthFrom, optional, tagMap } from './helpers';

const TAG_BATCH_SIZE = 20;
import {
  collectTargetGroups,
  type TargetGroupLink,
  targetsOfBalancer,
} from './load-balancer-targets';
import { isPublicSubnet } from './subnet-routing';

const AVAILABLE = { healthy: ['available'] };

const toVpcResource = (vpc: Vpc, region: string): CollectedResource => {
  const tags = tagMap(vpc.Tags);
  const nativeId = vpc.VpcId ?? '';
  const status = vpc.State ?? 'unknown';
  return {
    type: 'vpc',
    region,
    nativeId,
    name: tags['Name'] ?? nativeId,
    status,
    health: healthFrom(status, AVAILABLE),
    tags,
    details: { cidrBlock: vpc.CidrBlock, isDefault: vpc.IsDefault },
  };
};

const toSubnetResource = (
  subnet: Subnet,
  routeTables: readonly RouteTable[],
  region: string,
): CollectedResource => {
  const tags = tagMap(subnet.Tags);
  const nativeId = subnet.SubnetId ?? '';
  const status = subnet.State ?? 'unknown';
  return {
    type: 'subnet',
    region,
    nativeId,
    name: tags['Name'] ?? nativeId,
    status,
    health: healthFrom(status, AVAILABLE),
    tags,
    details: {
      vpcId: subnet.VpcId,
      cidrBlock: subnet.CidrBlock,
      availabilityZone: subnet.AvailabilityZone,
      availableIps: subnet.AvailableIpAddressCount,
      publicIpOnLaunch: subnet.MapPublicIpOnLaunch,
      public: isPublicSubnet(subnet, routeTables),
    },
  };
};

const opensToInternet = (group: SecurityGroup): boolean =>
  (group.IpPermissions ?? []).some(
    (rule) =>
      rule.IpRanges?.some((range) => range.CidrIp === '0.0.0.0/0') ||
      rule.Ipv6Ranges?.some((range) => range.CidrIpv6 === '::/0'),
  );

const allowedGroups = (group: SecurityGroup) =>
  (group.IpPermissions ?? []).flatMap(({ UserIdGroupPairs: pairs, FromPort, ToPort }) =>
    (pairs ?? []).flatMap(({ GroupId }) =>
      GroupId ? [{ groupId: GroupId, fromPort: FromPort, toPort: ToPort }] : [],
    ),
  );

const toSecurityGroupResource = (group: SecurityGroup, region: string): CollectedResource => {
  const nativeId = group.GroupId ?? '';
  return {
    type: 'security-group',
    region,
    nativeId,
    name: group.GroupName ?? nativeId,
    status: 'exists',
    health: 'healthy',
    tags: tagMap(group.Tags),
    details: {
      description: group.Description,
      vpcId: group.VpcId,
      inboundRules: group.IpPermissions?.length,
      outboundRules: group.IpPermissionsEgress?.length,
      openToInternet: opensToInternet(group),
      allowedFrom: allowedGroups(group),
    },
  };
};

const toLoadBalancerResource = (
  balancer: LoadBalancer,
  targetGroups: readonly TargetGroupLink[],
  region: string,
  tags: Record<string, string>,
): CollectedResource => {
  const status = balancer.State?.Code ?? 'unknown';
  return {
    type: 'load-balancer',
    region,
    nativeId: balancer.LoadBalancerArn ?? '',
    name: balancer.LoadBalancerName ?? '',
    status,
    health: healthFrom(status, {
      healthy: ['active'],
      degraded: ['active_impaired', 'failed'],
    }),
    tags,
    details: {
      type: balancer.Type,
      scheme: balancer.Scheme,
      dnsName: balancer.DNSName,
      vpcId: balancer.VpcId,
      subnetIds: balancer.AvailabilityZones?.flatMap(({ SubnetId }) => SubnetId ?? []),
      securityGroups: balancer.SecurityGroups,
      ...targetsOfBalancer(balancer.LoadBalancerArn ?? '', targetGroups),
    },
  };
};

const tagsOfBatch = async (client: ElasticLoadBalancingV2Client, ResourceArns: string[]) => {
  const { TagDescriptions = [] } = await client.send(new DescribeTagsCommand({ ResourceArns }));
  return TagDescriptions;
};

const balancerTags = async (
  client: ElasticLoadBalancingV2Client,
  balancers: readonly LoadBalancer[],
): Promise<Record<string, Record<string, string>>> => {
  const tags: Record<string, Record<string, string>> = {};
  const arns = balancers.flatMap(({ LoadBalancerArn: arn }) => arn ?? []);
  for (const ResourceArns of chunk(arns, TAG_BATCH_SIZE)) {
    const descriptions = await optional(tagsOfBatch(client, ResourceArns));
    for (const { ResourceArn, Tags } of descriptions) {
      tags[ResourceArn ?? ''] = tagMap(Tags);
    }
  }
  return tags;
};

export const networkCollector: ResourceCollector<AwsKey> = {
  name: 'network',
  label: 'network resources',
  scope: 'regional',
  types: ['vpc', 'subnet', 'security-group', 'load-balancer'],
  collect: async ({ credentials, region }) => {
    const client = new EC2Client({ region, credentials });
    const balancerClient = new ElasticLoadBalancingV2Client({ region, credentials });
    const [vpcs, subnets, groups, balancers, routeTables, targetGroups] = await Promise.all([
      collectPages(paginateDescribeVpcs({ client }, {}), (page) => page.Vpcs),
      collectPages(paginateDescribeSubnets({ client }, {}), (page) => page.Subnets),
      collectPages(paginateDescribeSecurityGroups({ client }, {}), (page) => page.SecurityGroups),
      collectPages(
        paginateDescribeLoadBalancers({ client: balancerClient }, {}),
        (page) => page.LoadBalancers,
      ),
      optional(collectPages(paginateDescribeRouteTables({ client }, {}), (page) => page.RouteTables)),
      optional(collectTargetGroups(balancerClient)),
    ]);
    const tags = await balancerTags(balancerClient, balancers);
    return [
      ...vpcs.map((item) => toVpcResource(item, region)),
      ...subnets.map((item) => toSubnetResource(item, routeTables, region)),
      ...groups.map((item) => toSecurityGroupResource(item, region)),
      ...balancers.map((item) =>
        toLoadBalancerResource(item, targetGroups, region, tags[item.LoadBalancerArn ?? ''] ?? {}),
      ),
    ];
  },
};
