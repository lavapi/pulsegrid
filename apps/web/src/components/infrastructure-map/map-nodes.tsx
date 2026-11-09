import type { MapGroup, MapNode } from '@pulsegrid/shared';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { Globe } from 'lucide-react';
import { ServiceIcon } from '@/components/service-icon';
import { cn } from '@/lib/utils';

const HEALTH_DOTS = {
  healthy: 'bg-success',
  degraded: 'bg-danger',
  stopped: 'bg-faint',
  unknown: 'bg-warning',
} as const;

const GROUP_STYLES = {
  vpc: 'border-border bg-muted/30',
  public: 'border-success/40 bg-success/5',
  private: 'border-primary/30 bg-primary/5',
} as const;

const HIDDEN_HANDLE = '!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent';

export interface ResourceNodeData extends Record<string, unknown> {
  node: MapNode;
  dimmed: boolean;
  selected: boolean;
}

export interface GroupNodeData extends Record<string, unknown> {
  group: MapGroup;
}

function NodeIcon({ node }: { node: MapNode }) {
  if (node.category === 'internet') {
    return (
      <span className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground">
        <Globe className="size-5" aria-hidden="true" />
      </span>
    );
  }
  return <ServiceIcon category={node.category} size={36} />;
}

export function ResourceNode({ data }: NodeProps) {
  const { node, dimmed, selected } = data as ResourceNodeData;
  return (
    <div
      className={cn(
        'flex h-full items-center gap-3 rounded-xl border bg-card px-3 shadow-sm transition-opacity',
        selected && 'border-primary ring-4 ring-ring',
        dimmed && 'opacity-30',
      )}
    >
      <Handle type="target" position={Position.Left} className={HIDDEN_HANDLE} isConnectable={false} />
      <NodeIcon node={node} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{node.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {node.status || node.typeLabel}
        </span>
      </span>
      {node.category !== 'internet' && (
        <span
          className={cn('size-2.5 shrink-0 rounded-full', HEALTH_DOTS[node.health])}
          role="img"
          aria-label={node.health}
        />
      )}
      <Handle type="source" position={Position.Right} className={HIDDEN_HANDLE} isConnectable={false} />
    </div>
  );
}

export function GroupNode({ data }: NodeProps) {
  const { group } = data as GroupNodeData;
  return (
    <div className={cn('size-full rounded-2xl border border-dashed', GROUP_STYLES[group.kind])}>
      <span className="block truncate px-4 py-2.5 text-xs font-medium text-muted-foreground">
        {group.label}
      </span>
    </div>
  );
}
