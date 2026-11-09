import type { ResourceHealth, ServiceCategory } from './inventory';

export const INTERNET_NODE_ID = 'internet';

export type MapEdgeKind = 'exact' | 'allowed';
export type MapGroupKind = 'vpc' | 'public' | 'private';

export interface MapGroup {
  id: string;
  kind: MapGroupKind;
  label: string;
  parentId: string | null;
}

export interface MapNode {
  id: string;
  category: ServiceCategory | 'internet';
  typeLabel: string;
  name: string;
  status: string;
  health: ResourceHealth;
  groupId: string | null;
  href: string | null;
}

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  kind: MapEdgeKind;
  label: string | null;
}

export interface InfrastructureMap {
  groups: MapGroup[];
  nodes: MapNode[];
  edges: MapEdge[];
  truncated: boolean;
}
