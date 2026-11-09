export const CLOUD_ACTIONS = {
  'service.redeploy': {
    label: 'Force deploy a staging service',
    buttonLabel: 'Force deploy',
    description: 'Starts new tasks and replaces the running ones. Nothing about the service changes.',
    success: 'Deployment started',
  },
  'database.reboot': {
    label: 'Reboot a staging database',
    buttonLabel: 'Reboot database',
    description: 'Connections drop while the database restarts, usually for a minute or two.',
    success: 'Database reboot started',
  },
  'cache.reboot': {
    label: 'Reboot a staging cache',
    buttonLabel: 'Reboot cache',
    description: 'Every node restarts. Data stored in the cache can be lost unless it is replicated or persisted.',
    success: 'Cache reboot started',
  },
  'server.reboot': {
    label: 'Reboot a staging server',
    buttonLabel: 'Reboot server',
    description: 'The server goes offline briefly while it restarts.',
    success: 'Server reboot started',
  },
} as const;

export type CloudPermission = keyof typeof CLOUD_ACTIONS;

export const CLOUD_PERMISSIONS = Object.keys(CLOUD_ACTIONS) as CloudPermission[];

export const isCloudPermission = (value: string): value is CloudPermission =>
  Object.hasOwn(CLOUD_ACTIONS, value);

export const ACTION_RUN_STATUSES = ['running', 'succeeded', 'failed', 'timed_out', 'unconfirmed'] as const;

export type ActionRunStatus = (typeof ACTION_RUN_STATUSES)[number];

export interface ActionRun {
  id: string;
  resourceId: string;
  title: string;
  status: ActionRunStatus;
  summary: string;
  startedBy: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ResourceActionOption {
  permission: CloudPermission;
  blockedReason: string | null;
}
