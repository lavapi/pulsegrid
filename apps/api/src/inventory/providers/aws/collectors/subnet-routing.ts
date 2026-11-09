import type { RouteTable, Subnet } from '@aws-sdk/client-ec2';

const ANYWHERE = '0.0.0.0/0';
const INTERNET_GATEWAY_PREFIX = 'igw-';

const reachesInternet = ({ Routes: routes }: RouteTable): boolean =>
  (routes ?? []).some(
    ({ DestinationCidrBlock: destination, GatewayId: gateway }) =>
      destination === ANYWHERE && gateway?.startsWith(INTERNET_GATEWAY_PREFIX),
  );

const isAssociatedWith = (table: RouteTable, subnetId: string | undefined): boolean =>
  (table.Associations ?? []).some(({ SubnetId }) => SubnetId === subnetId);

const isMainFor = (table: RouteTable, vpcId: string | undefined): boolean =>
  table.VpcId === vpcId && (table.Associations ?? []).some(({ Main }) => Main);

export const isPublicSubnet = (
  subnet: Subnet,
  tables: readonly RouteTable[],
): boolean | undefined => {
  if (tables.length === 0) {
    return undefined;
  }
  const table =
    tables.find((item) => isAssociatedWith(item, subnet.SubnetId)) ??
    tables.find((item) => isMainFor(item, subnet.VpcId));
  return table ? reachesInternet(table) : false;
};
