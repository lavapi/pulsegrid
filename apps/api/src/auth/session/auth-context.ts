import type { UserPermission } from '@pulsegrid/shared';

export interface ProjectAccess {
  tenantId: string;
  userId: string;
  roleName: string;
  permissions: ReadonlySet<UserPermission>;
}

export interface PersonContext {
  sessionId: string;
  accountId: string;
  email: string;
  displayName: string;
  isOwner: boolean;
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
  project: ProjectAccess | null;
}

export type AuthContext = Omit<PersonContext, 'project'> & ProjectAccess;

export const projectAuth = ({ project, ...person }: PersonContext): AuthContext | null =>
  project ? { ...person, ...project } : null;
