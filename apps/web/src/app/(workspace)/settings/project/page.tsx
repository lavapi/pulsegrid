import type { ProjectList } from '@pulsegrid/shared';
import { redirect } from 'next/navigation';
import { DeleteProjectCard } from '@/components/projects/delete-project-card';
import { RenameProjectForm } from '@/components/projects/rename-project-form';
import { PageHeader } from '@/components/ui/page-header';
import { apiGet, getCurrentUser } from '@/lib/server-api';

export default async function ProjectSettingsPage() {
  const user = await getCurrentUser();
  if (!user.isOwner || !user.tenant) {
    redirect('/');
  }
  const { projects } = await apiGet<ProjectList>('/projects');
  return (
    <>
      <PageHeader title="Project" description={`Settings for ${user.tenant.name}.`} />
      <RenameProjectForm name={user.tenant.name} />
      <DeleteProjectCard name={user.tenant.name} isOnlyProject={projects.length <= 1} />
    </>
  );
}
