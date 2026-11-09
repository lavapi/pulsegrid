import { NO_PROJECT, type ProjectList } from '@pulsegrid/shared';
import { redirect } from 'next/navigation';
import { AuthPage } from '@/components/auth/auth-page';
import { NoProjectPanel } from '@/components/projects/no-project-panel';
import { apiGet, getCurrentUser } from '@/lib/server-api';

export default async function NoProjectPage() {
  const user = await getCurrentUser();
  if (user.mustChangePassword) {
    redirect('/change-password');
  }
  if (!user.twoFactorEnabled) {
    redirect('/setup-two-factor');
  }
  if (user.tenant) {
    redirect('/');
  }
  const { projects } = await apiGet<ProjectList>('/projects');
  return (
    <AuthPage
      title={projects.length > 0 ? 'Choose a project' : 'No project yet'}
      description={projects.length > 0 ? 'Pick a project to open.' : NO_PROJECT}
    >
      <NoProjectPanel projects={projects} />
    </AuthPage>
  );
}
