import {
  DescribeTargetHealthCommand,
  type ElasticLoadBalancingV2Client,
  paginateDescribeTargetGroups,
  type TargetGroup,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { collectPages } from './helpers';

const INSTANCE_TARGET = 'instance';

export interface TargetGroupLink {
  arn: string;
  balancerArns: string[];
  instanceIds: string[];
}

const instancesOf = async (
  client: ElasticLoadBalancingV2Client,
  group: TargetGroup,
): Promise<string[]> => {
  if (group.TargetType !== INSTANCE_TARGET) {
    return [];
  }
  const { TargetHealthDescriptions: targets } = await client.send(
    new DescribeTargetHealthCommand({ TargetGroupArn: group.TargetGroupArn }),
  );
  return (targets ?? []).flatMap(({ Target }) => (Target?.Id ? [Target.Id] : []));
};

export const collectTargetGroups = async (
  client: ElasticLoadBalancingV2Client,
): Promise<TargetGroupLink[]> => {
  const groups = await collectPages(
    paginateDescribeTargetGroups({ client }, {}),
    (page) => page.TargetGroups,
  );
  return Promise.all(
    groups.map(async (group) => ({
      arn: group.TargetGroupArn ?? '',
      balancerArns: group.LoadBalancerArns ?? [],
      instanceIds: await instancesOf(client, group),
    })),
  );
};

export const targetsOfBalancer = (balancerArn: string, links: readonly TargetGroupLink[]) => {
  const linked = links.filter(({ balancerArns }) => balancerArns.includes(balancerArn));
  return {
    targetGroups: linked.map(({ arn }) => arn),
    targetInstances: [...new Set(linked.flatMap(({ instanceIds }) => instanceIds))],
  };
};
