import type { InfrastructureMap, MapEdge, MapGroup, MapNode } from '@pulsegrid/shared';
import type { ElkNode } from 'elkjs/lib/elk-api';

export const NODE_WIDTH = 232;
export const NODE_HEIGHT = 72;

const GROUP_LAYOUT = {
  'elk.padding': '[top=40,left=20,bottom=20,right=20]',
};
const ROOT_LAYOUT = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '96',
  'elk.spacing.nodeNode': '28',
  'elk.padding': '[top=20,left=20,bottom=20,right=20]',
};

export interface MapFilters {
  vpcId: string;
  hiddenCategories: readonly string[];
}

export interface PlacedItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parentId: string | null;
}

const vpcOfGroup = (groupId: string | null): string | null =>
  groupId ? groupId.split(':').slice(0, 2).join(':') : null;

export const vpcGroups = ({ groups }: InfrastructureMap): MapGroup[] =>
  groups.filter(({ kind }) => kind === 'vpc');

export const filterMap = (map: InfrastructureMap, filters: MapFilters): InfrastructureMap => {
  const { vpcId, hiddenCategories } = filters;
  const inVpc = (node: MapNode): boolean =>
    !vpcId || node.category === 'internet' || vpcOfGroup(node.groupId) === vpcId;
  const kept = map.nodes.filter(
    (node) => !hiddenCategories.includes(node.category) && inVpc(node),
  );
  const ids = new Set(kept.map(({ id }) => id));
  const edges = map.edges.filter(({ source, target }) => ids.has(source) && ids.has(target));
  const nodes = kept.filter(
    (node) => node.category !== 'internet' || edges.some(({ source }) => source === node.id),
  );
  const groupIds = new Set(nodes.flatMap(({ groupId }) => groupId ?? []));
  const groups = map.groups.filter(
    ({ id }) => groupIds.has(id) || [...groupIds].some((groupId) => vpcOfGroup(groupId) === id),
  );
  return { ...map, nodes, edges, groups };
};

const leaf = ({ id }: MapNode): ElkNode => ({ id, width: NODE_WIDTH, height: NODE_HEIGHT });

const groupChildren = (map: InfrastructureMap, parentId: string | null): ElkNode[] => [
  ...map.groups
    .filter((group) => group.parentId === parentId)
    .map((group) => ({
      id: group.id,
      layoutOptions: GROUP_LAYOUT,
      children: groupChildren(map, group.id),
    })),
  ...map.nodes.filter(({ groupId }) => groupId === parentId).map(leaf),
];

export const toElkGraph = (map: InfrastructureMap): ElkNode => ({
  id: 'root',
  layoutOptions: ROOT_LAYOUT,
  children: groupChildren(map, null),
  edges: map.edges.map(({ id, source, target }) => ({ id, sources: [source], targets: [target] })),
});

export const flattenLayout = (root: ElkNode): PlacedItem[] => {
  const visit = (node: ElkNode, parentId: string | null): PlacedItem[] => [
    {
      id: node.id,
      x: node.x ?? 0,
      y: node.y ?? 0,
      width: node.width ?? NODE_WIDTH,
      height: node.height ?? NODE_HEIGHT,
      parentId,
    },
    ...(node.children ?? []).flatMap((child) => visit(child, node.id)),
  ];
  return (root.children ?? []).flatMap((child) => visit(child, null));
};

export const layoutMap = async (map: InfrastructureMap): Promise<PlacedItem[]> => {
  const { default: Elk } = await import('elkjs/lib/elk.bundled.js');
  return flattenLayout(await new Elk().layout(toElkGraph(map)));
};

export const connectionsOf = (edges: readonly MapEdge[], nodeId: string): MapEdge[] =>
  edges.filter(({ source, target }) => source === nodeId || target === nodeId);
