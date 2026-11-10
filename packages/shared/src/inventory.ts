import type { TagFilter } from './tag-filter';
import type { HealthCounts } from './environments';
import {
  AWS_RESOURCE_TYPES,
  AWS_SERVICE_CATEGORIES,
  AWS_SERVICES,
} from './providers/aws';

export const RESOURCE_TYPES = { ...AWS_RESOURCE_TYPES };

export const SERVICE_CATEGORIES = { ...AWS_SERVICE_CATEGORIES };

export type ServiceCategory = keyof typeof SERVICE_CATEGORIES;

export const isServiceCategory = (value: string): value is ServiceCategory =>
  value in SERVICE_CATEGORIES;

export const resourceTypesIn = (category: ServiceCategory): ResourceType[] =>
  (Object.keys(RESOURCE_TYPES) as ResourceType[]).filter(
    (type) => RESOURCE_TYPES[type].category === category,
  );

export type ResourceType = keyof typeof RESOURCE_TYPES;

export const categoryOf = (type: ResourceType): ServiceCategory => RESOURCE_TYPES[type].category;

export const resourceTypeLabel = (type: ResourceType): string => {
  const { label } = RESOURCE_TYPES[type];
  const category = categoryOf(type);
  return category === 'load-balancing' || category === 'vpc'
    ? label
    : `${SERVICE_CATEGORIES[category].label} ${label.toLowerCase()}`;
};

export const resourcePath = (resource: { id: string; type: ResourceType }): string =>
  `/infrastructure/${categoryOf(resource.type)}/${resource.id}`;

export const isResourceType = (value: string): value is ResourceType => value in RESOURCE_TYPES;

export const RESOURCE_HEALTH = ['healthy', 'degraded', 'stopped', 'unknown'] as const;

export type ResourceHealth = (typeof RESOURCE_HEALTH)[number];

export const CLOUD_ACCOUNT_STATUSES = ['pending', 'connected', 'error'] as const;

export type CloudAccountStatus = (typeof CLOUD_ACCOUNT_STATUSES)[number];

export const CLOUD_SERVICES = { ...AWS_SERVICES };

export type CloudService = keyof typeof CLOUD_SERVICES;

export interface CredentialServiceCheck {
  service: CloudService;
  label: string;
  readable: boolean;
}

export interface CredentialCheck {
  accountId: string;
  services: CredentialServiceCheck[];
  canWrite: boolean | null;
  /** Actions from the PulseGrid policy that the credentials lack, or null when that couldn't be checked. */
  missingActions: string[] | null;
}

export interface SyncIssue {
  collector: string;
  region: string;
  message: string;
}

export interface CloudAccount {
  id: string;
  provider: string;
  accountId: string;
  name: string;
  regions: string[];
  status: CloudAccountStatus;
  lastError: string | null;
  lastSyncedAt: string | null;
  syncIssues: SyncIssue[];
  hasCredentials: boolean;
  credentialHint: string | null;
  canWrite: boolean | null;
  tagFilter: TagFilter;
  environmentId: string | null;
  environmentName: string | null;
  isProduction: boolean;
}

export interface Resource {
  id: string;
  type: ResourceType;
  nativeId: string;
  name: string;
  status: string;
  health: ResourceHealth;
  region: string;
  cloudAccount: { id: string; accountId: string; name: string };
  tags: Record<string, string>;
  details: Record<string, unknown>;
  lastSeenAt: string;
}

export interface ResourcePage {
  resources: Resource[];
  nextCursor: string | null;
}

export interface ResourceTypeCount {
  type: ResourceType;
  count: number;
}

export interface ServiceCategorySummary {
  category: ServiceCategory;
  health: HealthCounts;
  types: ResourceTypeCount[];
  launchTypes: string[];
}
