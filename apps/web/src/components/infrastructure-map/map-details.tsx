import type { InfrastructureMap, MapNode } from '@pulsegrid/shared';
import { X } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { connectionsOf } from '@/lib/map-layout';

interface MapDetailsProps {
  map: InfrastructureMap;
  node: MapNode;
  onClose: () => void;
}

export function MapDetails({ map, node, onClose }: MapDetailsProps) {
  const nameOf = (id: string): string => map.nodes.find((item) => item.id === id)?.name ?? id;
  const connections = connectionsOf(map.edges, node.id);

  return (
    <aside className="absolute right-3 top-3 z-10 flex max-h-[calc(100%-1.5rem)] w-72 max-w-[calc(100%-1.5rem)] flex-col gap-3 overflow-y-auto rounded-xl border bg-card p-4 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{node.name}</h2>
          <p className="text-[13px] text-muted-foreground">{node.typeLabel}</p>
        </div>
        <Button size="sm" variant="ghost" aria-label="Close details" onClick={onClose}>
          <X />
        </Button>
      </div>
      {node.status && <p className="text-[13px]">{node.status}</p>}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground">Connections</h3>
        {connections.length > 0 ? (
          <ul className="mt-1.5 flex flex-col gap-1.5 text-[13px]">
            {connections.map(({ id, source, target, kind, label }) => (
              <li key={id}>
                {source === node.id ? `To ${nameOf(target)}` : `From ${nameOf(source)}`}
                <span className="block text-xs text-muted-foreground">
                  {kind === 'exact' ? 'Connected' : 'Allowed by security group'}
                  {label && ` · ${label}`}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-[13px] text-muted-foreground">No connections found</p>
        )}
      </div>
      {node.href && (
        <Button asChild size="sm">
          <Link href={node.href}>Open details</Link>
        </Button>
      )}
    </aside>
  );
}
