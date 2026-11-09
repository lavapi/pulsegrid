'use client';

import type { Project } from '@pulsegrid/shared';
import { useSignOut } from '@/components/auth/use-sign-out';
import { Button } from '@/components/ui/button';
import { useSelectProject } from './use-select-project';

export function NoProjectPanel({ projects }: { projects: Project[] }) {
  const signOut = useSignOut();
  const { pending, select } = useSelectProject();

  return (
    <div className="flex flex-col gap-4">
      {projects.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Your projects">
          {projects.map((project) => (
            <li key={project.id}>
              <Button className="w-full justify-start" disabled={pending} onClick={() => select(project.id)}>
                Open {project.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="ghost" onClick={signOut}>
        Sign out
      </Button>
    </div>
  );
}
