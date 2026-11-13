import type { EnvironmentDomain } from './environment-domains';
import type { CloudService, ResourceHealth, ResourceType } from './inventory';

export type HealthCounts = Record<ResourceHealth, number> & { total: number };

export interface EnvironmentAccount {
  id: string;
  accountId: string;
  name: string;
}

export interface EnvironmentSummary {
  id: string;
  name: string;
  accounts: EnvironmentAccount[];
  health: HealthCounts;
  services: { service: CloudService; health: HealthCounts }[];
  lastSyncedAt: string | null;
  domains: EnvironmentDomain[];
}

export interface ManagedEnvironment {
  id: string;
  name: string;
}

export interface EnvironmentAssignment {
  cloudAccountId: string;
  accountId: string;
  name: string;
  environmentId: string | null;
}

export interface EnvironmentWithDomains extends ManagedEnvironment {
  isProduction: boolean;
  domains: EnvironmentDomain[];
}

export interface EnvironmentAdminView {
  environments: EnvironmentWithDomains[];
  accounts: EnvironmentAssignment[];
}

export const COMPARISON_STATES = ['same', 'different', 'only_left', 'only_right'] as const;

export type ComparisonState = (typeof COMPARISON_STATES)[number];

export interface ComparedResource {
  id: string;
  /** The cloud name, which resources are matched across environments by. */
  name: string;
  displayName: string | null;
  status: string;
  health: ResourceHealth;
}

export interface ComparisonDifference {
  field: string;
  left: string;
  right: string;
}

export interface ComparisonRow {
  type: ResourceType;
  key: string;
  state: ComparisonState;
  left: ComparedResource | null;
  right: ComparedResource | null;
  differences: ComparisonDifference[];
}

export interface EnvironmentComparison {
  left: ManagedEnvironment;
  right: ManagedEnvironment;
  rows: ComparisonRow[];
}
