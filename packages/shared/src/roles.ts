import type { UserPermission } from './permissions';

export interface RoleInput {
  name: string;
  permissions: UserPermission[];
}

export interface Role extends RoleInput {
  id: string;
  memberCount: number;
}
