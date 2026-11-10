import { hasPermission, type Role } from '@pulsegrid/shared';
import { redirect } from 'next/navigation';
import { RoleManager } from '@/components/team/role-manager';
import { PageHeader } from '@/components/ui/page-header';
import { apiGet, getCurrentUser } from '@/lib/server-api';

export default async function RolesPage() {
  const user = await getCurrentUser();
  if (!hasPermission(user, 'team.view')) {
    redirect('/');
  }
  const roles = await apiGet<Role[]>('/roles');
  return (
    <>
      <PageHeader
        title="Roles"
        description={
          user.isOwner
            ? 'Create roles and choose what each one can do. Staging and production permissions are separate, so a role can act on one without the other.'
            : 'Only the super admin can change roles.'
        }
      />
      <RoleManager roles={roles} canManage={user.isOwner} />
    </>
  );
}
