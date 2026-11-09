'use client';

import {
  type InfrastructureMap,
  isServiceCategory,
  type MapEdge,
  SERVICE_CATEGORIES,
} from '@pulsegrid/shared';
import {
  Background,
  type Edge,
  MarkerType,
  Controls,
  type Node,
  ReactFlow,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useState } from 'react';
import { CanvasSkeleton } from '@/components/skeletons';
import { Dropdown } from '@/components/ui/dropdown';
import {
  connectionsOf,
  filterMap,
  layoutMap,
  type PlacedItem,
  vpcGroups,
} from '@/lib/map-layout';
import { cn } from '@/lib/utils';
import { MapDetails } from './map-details';
import { GroupNode, ResourceNode } from './map-nodes';

const NODE_TYPES = { resource: ResourceNode, network: GroupNode };
const EDGE_COLOR = 'var(--muted-foreground)';
const DIMMED_OPACITY = 0.12;

const toFlowNodes = (map: InfrastructureMap, placed: readonly PlacedItem[]): Node[] =>
  placed.flatMap((item): Node[] => {
    const shared = {
      id: item.id,
      position: { x: item.x, y: item.y },
      style: { width: item.width, height: item.height },
      ...(item.parentId ? { parentId: item.parentId } : {}),
    };
    const group = map.groups.find(({ id }) => id === item.id);
    if (group) {
      return [{ ...shared, type: 'network', data: { group }, selectable: false }];
    }
    const node = map.nodes.find(({ id }) => id === item.id);
    return node ? [{ ...shared, type: 'resource', data: { node } }] : [];
  });

const toFlowEdge = (edge: MapEdge, dimmed: boolean): Edge => ({
  id: edge.id,
  source: edge.source,
  target: edge.target,
  type: 'smoothstep',
  zIndex: 1,
  markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOR },
  ...(edge.label ? { label: edge.label } : {}),
  style: {
    stroke: EDGE_COLOR,
    strokeDasharray: edge.kind === 'allowed' ? '6 5' : undefined,
    opacity: dimmed ? DIMMED_OPACITY : 1,
  },
});

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <i className="w-6 border-t-2 border-muted-foreground" aria-hidden="true" />
        Connected
      </span>
      <span className="flex items-center gap-1.5">
        <i className="w-6 border-t-2 border-dashed border-muted-foreground" aria-hidden="true" />
        Allowed by security group
      </span>
    </div>
  );
}

export function InfrastructureMapView({ map }: { map: InfrastructureMap }) {
  const { resolvedTheme } = useTheme();
  const [vpcId, setVpcId] = useState('');
  const [hiddenCategories, setHiddenCategories] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layoutKey, setLayoutKey] = useState(0);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);

  const visible = useMemo(
    () => filterMap(map, { vpcId, hiddenCategories }),
    [map, vpcId, hiddenCategories],
  );

  useEffect(() => {
    let current = true;
    void layoutMap(visible).then((placed) => {
      if (current) {
        setNodes(toFlowNodes(visible, placed));
        setLayoutKey((key) => key + 1);
      }
    });
    return () => {
      current = false;
    };
  }, [visible, setNodes]);

  const connected = useMemo(() => {
    if (!selectedId) {
      return null;
    }
    const ids = connectionsOf(visible.edges, selectedId).flatMap(({ source, target }) => [source, target]);
    return new Set([selectedId, ...ids]);
  }, [selectedId, visible.edges]);

  const displayNodes = nodes.map((item) =>
    item.type === 'resource'
      ? {
          ...item,
          data: {
            ...item.data,
            selected: item.id === selectedId,
            dimmed: connected !== null && !connected.has(item.id),
          },
        }
      : item,
  );
  const edges = visible.edges.map((edge) =>
    toFlowEdge(edge, selectedId !== null && edge.source !== selectedId && edge.target !== selectedId),
  );

  const categories = [...new Set(map.nodes.map(({ category }) => category))].filter(
    isServiceCategory,
  );
  const toggle = (category: string) =>
    setHiddenCategories((hidden) =>
      hidden.includes(category) ? hidden.filter((item) => item !== category) : [...hidden, category],
    );
  const selected = visible.nodes.find(({ id }) => id === selectedId);
  const vpcs = vpcGroups(map);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        {vpcs.length > 1 && (
          <Dropdown
            label="VPC"
            value={vpcId}
            onValueChange={setVpcId}
            className="w-auto min-w-48"
            options={[
              { value: '', label: 'All VPCs' },
              ...vpcs.map(({ id, label }) => ({ value: id, label })),
            ]}
          />
        )}
        {categories.map((category) => (
          <button
            type="button"
            key={category}
            aria-pressed={!hiddenCategories.includes(category)}
            onClick={() => toggle(category)}
            className={cn(
              'h-8 rounded-lg border px-3 text-[13px] transition-colors hover:bg-muted',
              hiddenCategories.includes(category)
                ? 'text-faint line-through'
                : 'bg-card text-foreground',
            )}
          >
            {SERVICE_CATEGORIES[category].label}
          </button>
        ))}
        <div className="ml-auto">
          <Legend />
        </div>
      </div>
      {layoutKey === 0 && <CanvasSkeleton />}
      <div
        className={cn(
          'relative h-[calc(100dvh-240px)] min-h-[520px] overflow-hidden rounded-xl border bg-card',
          layoutKey === 0 && 'hidden',
        )}
      >
        <ReactFlow
          key={layoutKey}
          nodes={displayNodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onNodeClick={(_, node) => node.type === 'resource' && setSelectedId(node.id)}
          onPaneClick={() => setSelectedId(null)}
          colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
          nodesConnectable={false}
          minZoom={0.1}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
        {selected && (
          <MapDetails map={visible} node={selected} onClose={() => setSelectedId(null)} />
        )}
      </div>
    </>
  );
}
