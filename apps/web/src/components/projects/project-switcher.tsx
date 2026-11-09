'use client';

import type { Project } from '@pulsegrid/shared';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { NewProjectDialog } from './new-project-dialog';
import { useSelectProject } from './use-select-project';

const ITEM =
  'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] outline-none data-[highlighted]:bg-ring data-[disabled]:cursor-default data-[disabled]:opacity-60';

const initialOf = (name: string): string => name.trim().charAt(0).toUpperCase() || 'P';

interface ProjectSwitcherProps {
  projects: Project[];
  currentId: string;
  canCreate: boolean;
  collapsed: boolean;
}

export function ProjectSwitcher({ projects, currentId, canCreate, collapsed }: ProjectSwitcherProps) {
  const [creating, setCreating] = useState(false);
  const { pending, select } = useSelectProject();
  const current = projects.find(({ id }) => id === currentId);
  const name = current?.name ?? 'Project';

  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          aria-label={`Project: ${name}. Switch project`}
          disabled={pending}
          className={cn(
            'mb-4 flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-muted',
            collapsed && 'justify-center px-0',
          )}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground">
            {initialOf(name)}
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate font-semibold">{name}</span>
                <span className="block truncate text-xs text-muted-foreground">PulseGrid</span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-faint" aria-hidden="true" />
            </>
          )}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content
            align="start"
            sideOffset={4}
            className="z-50 w-64 rounded-xl border border-popover-border bg-popover p-1.5 text-sm shadow-2xl shadow-black/30"
          >
            <Menu.Label className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold text-faint">Projects</Menu.Label>
            {projects.map((project) => (
              <Menu.Item
                key={project.id}
                className={ITEM}
                disabled={project.id === currentId}
                onSelect={() => select(project.id)}
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-[11px] font-semibold">
                  {initialOf(project.name)}
                </span>
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                {project.id === currentId && <Check className="size-4 text-primary" aria-label="Current project" />}
              </Menu.Item>
            ))}
            {canCreate && (
              <>
                <Menu.Separator className="my-1 h-px bg-border" />
                <Menu.Item className={cn(ITEM, 'text-muted-foreground')} onSelect={() => setCreating(true)}>
                  <Plus className="size-4" aria-hidden="true" />
                  New project
                </Menu.Item>
              </>
            )}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <NewProjectDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
