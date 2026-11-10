import type { CurrentUser, UserPermission } from '@pulsegrid/shared';
import {
  CircleDollarSign,
  FlaskConical,
  FolderCog,
  History,
  GitBranch,
  Layers,
  type LucideIcon,
  LayoutDashboard,
  Plug,
  Rocket,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  UserRoundCog,
  Users,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: UserPermission;
  superAdminOnly?: boolean;
}

export type NavAccess = Pick<CurrentUser, 'permissions' | 'isOwner'>;

export const MAIN_NAV: NavItem[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/environments', label: 'Environments', icon: Layers },
  { href: '/infrastructure', label: 'Infrastructure', icon: Server },
  { href: '/pipelines', label: 'Pipelines', icon: GitBranch },
  { href: '/releases', label: 'Releases', icon: Rocket },
  { href: '/experiments', label: 'Experiments', icon: FlaskConical },
  { href: '/costs', label: 'Costs', icon: CircleDollarSign, permission: 'costs.view' },
  { href: '/activity', label: 'Activity', icon: History, permission: 'activity.view' },
];

export const SETTINGS_NAV: NavItem[] = [
  { href: '/settings/project', label: 'Project', icon: FolderCog, superAdminOnly: true },
  {
    href: '/settings/environments',
    label: 'Manage environments',
    icon: SlidersHorizontal,
    permission: 'environments.manage',
  },
  { href: '/settings/integrations', label: 'Integrations', icon: Plug, permission: 'integrations.manage' },
  { href: '/settings/team', label: 'Members', icon: Users, permission: 'team.view' },
  { href: '/settings/people', label: 'People', icon: UserRoundCog, superAdminOnly: true },
  { href: '/settings/roles', label: 'Roles', icon: ShieldCheck, permission: 'team.view' },
];

export const allowedNav = (items: NavItem[], { permissions, isOwner }: NavAccess): NavItem[] =>
  items.filter(
    ({ permission, superAdminOnly }) =>
      (!superAdminOnly || isOwner) && (!permission || permissions.includes(permission)),
  );

export const isActivePath = (pathname: string, href: string): boolean =>
  href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
