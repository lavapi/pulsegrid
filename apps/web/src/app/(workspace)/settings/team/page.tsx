import { hasPermission, type Person, type Role, type Team } from '@pulsegrid/shared';
import { redirect } from 'next/navigation';
import { AssignMemberForm } from '@/components/team/assign-member-form';
import { TeamManager } from '@/components/team/team-manager';
import { PageHeader } from '@/components/ui/page-header';
import { apiGet, getCurrentUser } from '@/lib/server-api';

export default async function MembersPage() {
  const user = await getCurrentUser();
  if (!hasPermission(user, 'team.view') || !user.tenant) {
    redirect('/');
  }
  const projectName = user.tenant.name;
  const [team, roles, people] = await Promise.all([
    apiGet<Team>('/team'),
    apiGet<Role[]>('/roles'),
    user.isOwner ? apiGet<Person[]>('/people') : Promise.resolve([]),
  ]);
  const outside = people.filter(({ projects }) => !projects.some(({ id }) => id === user.tenant?.id));
  return (
    <>
      <PageHeader
        title="Members"
        description={
          user.isOwner
            ? `Who can open ${projectName}, and their role here.`
            : 'Only the super admin can change members.'
        }
      />
      {user.isOwner && <AssignMemberForm people={outside} roles={roles} projectName={projectName} />}
      <TeamManager
        team={team}
        roles={roles}
        currentUserId={user.id}
        canManage={user.isOwner}
        projectName={projectName}
      />
    </>
  );
}
