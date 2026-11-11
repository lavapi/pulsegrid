import { DescribeInstanceTypesCommand, DescribeVolumesCommand, EC2Client, type _InstanceType } from '@aws-sdk/client-ec2';
import { DescribeTaskDefinitionCommand, ECSClient } from '@aws-sdk/client-ecs';
import type { AwsKey } from './aws-key';

const BYTES_PER_MIB = 1024 ** 2;
const BYTES_PER_GIB = 1024 ** 3;
const CPU_UNITS_PER_VCPU = 1024;

export interface InstanceSpec {
  vcpus: number;
  memoryBytes: number;
}

export interface TaskSize {
  vcpus: number;
  memoryBytes: number;
}

export interface DiskSizes {
  totalBytes: number;
  rootBytes: number | null;
  count: number;
}

interface Lookup {
  credentials: AwsKey;
  region: string;
}

/** Instance types and task definition revisions never change, so their sizes are kept for the life of the process. */
const specs = new Map<string, InstanceSpec | null>();
const tasks = new Map<string, TaskSize | null>();

/** RDS and ElastiCache classes are EC2 types with a prefix: db.r6g.large and cache.r6g.large are both r6g.large. */
export const ec2TypeOf = (type: string): string => type.replace(/^(db|cache)\./, '');

const isUnknownType = (error: unknown): boolean => (error as Error).name === 'InvalidInstanceType';

/** vCPUs and memory of an instance type, or null when AWS doesn't know it or the key can't look it up. */
export const instanceSpec = async ({ credentials, region }: Lookup, type: string): Promise<InstanceSpec | null> => {
  const ec2Type = ec2TypeOf(type);
  const key = `${region}/${ec2Type}`;
  if (specs.has(key)) {
    return specs.get(key) ?? null;
  }
  try {
    const { InstanceTypes = [] } = await new EC2Client({ region, credentials }).send(
      new DescribeInstanceTypesCommand({ InstanceTypes: [ec2Type as _InstanceType] }),
    );
    const info = InstanceTypes[0];
    const spec =
      info?.VCpuInfo?.DefaultVCpus && info.MemoryInfo?.SizeInMiB
        ? { vcpus: info.VCpuInfo.DefaultVCpus, memoryBytes: info.MemoryInfo.SizeInMiB * BYTES_PER_MIB }
        : null;
    specs.set(key, spec);
    return spec;
  } catch (error) {
    if (isUnknownType(error)) {
      specs.set(key, null);
    }
    return null;
  }
};

/** The CPU and memory one task reserves, from the task level or, failing that, the sum of its containers. */
export const taskSize = async ({ credentials, region }: Lookup, taskDefinition: string): Promise<TaskSize | null> => {
  const key = `${region}/${taskDefinition}`;
  if (tasks.has(key)) {
    return tasks.get(key) ?? null;
  }
  try {
    const { taskDefinition: definition } = await new ECSClient({ region, credentials }).send(
      new DescribeTaskDefinitionCommand({ taskDefinition }),
    );
    const containers = definition?.containerDefinitions ?? [];
    const cpu = Number(definition?.cpu) || containers.reduce((sum, item) => sum + (item.cpu ?? 0), 0);
    const memory =
      Number(definition?.memory) ||
      containers.reduce((sum, item) => sum + (item.memory ?? item.memoryReservation ?? 0), 0);
    const size =
      cpu > 0 && memory > 0 ? { vcpus: cpu / CPU_UNITS_PER_VCPU, memoryBytes: memory * BYTES_PER_MIB } : null;
    tasks.set(key, size);
    return size;
  } catch {
    return null;
  }
};

/** The size of a server's EBS disks, read live because volumes can grow. */
export const diskSizes = async (
  { credentials, region }: Lookup,
  volumeIds: readonly string[],
  rootVolumeId: string | null,
): Promise<DiskSizes | null> => {
  if (volumeIds.length === 0) {
    return null;
  }
  try {
    const { Volumes = [] } = await new EC2Client({ region, credentials }).send(
      new DescribeVolumesCommand({ VolumeIds: [...volumeIds] }),
    );
    const sizeOf = (size: number | undefined) => (size ?? 0) * BYTES_PER_GIB;
    const root = Volumes.find(({ VolumeId }) => VolumeId === rootVolumeId);
    return {
      totalBytes: Volumes.reduce((sum, { Size }) => sum + sizeOf(Size), 0),
      rootBytes: root ? sizeOf(root.Size) : null,
      count: Volumes.length,
    };
  } catch {
    return null;
  }
};
