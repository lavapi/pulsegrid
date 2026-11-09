'use client';

import type { CurrentUser, Project } from '@pulsegrid/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ProjectSwitcher } from '@/components/projects/project-switcher';
import { allowedNav, isActivePath, MAIN_NAV, type NavItem, SETTINGS_NAV } from '@/lib/navigation';
import { cn } from '@/lib/utils';

const APP_VERSION = process.env.APP_VERSION;

function NavLink({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  const pathname = usePathname();
  const active = isActivePath(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      className={cn(
        'flex h-9 items-center gap-2.5 rounded-lg px-2.5 font-medium transition-colors',
        collapsed && 'justify-center px-0',
        active
          ? 'bg-ring text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <Icon className={cn('size-[17px] shrink-0', active && 'text-primary')} aria-hidden="true" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

export function Sidebar({
  user,
  projects,
  collapsed = false,
  onNavigate,
}: {
  user: CurrentUser;
  projects: Project[];
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const settings = allowedNav(SETTINGS_NAV, user);
  return (
    <div className="flex h-full flex-col gap-1 px-3 py-4">
      <ProjectSwitcher
        projects={projects}
        currentId={user.tenant?.id ?? ''}
        canCreate={user.isOwner}
        collapsed={collapsed}
      />
      <nav className="flex flex-col gap-0.5" aria-label="Main">
        {allowedNav(MAIN_NAV, user).map((item) => (
          <NavLink item={item} collapsed={collapsed} onNavigate={onNavigate} key={item.href} />
        ))}
      </nav>
      {settings.length > 0 && (
        <nav className="mt-5 flex flex-col gap-0.5" aria-label="Settings">
          {!collapsed && (
            <span className="px-2.5 pb-1.5 text-[11px] font-semibold text-faint">Settings</span>
          )}
          {settings.map((item) => (
            <NavLink item={item} collapsed={collapsed} onNavigate={onNavigate} key={item.href} />
          ))}
        </nav>
      )}
      {APP_VERSION && (
        <span
          className={cn('mt-auto px-2.5 pt-4 text-[11px] text-faint', collapsed && 'px-0 text-center')}
          title={`Version ${APP_VERSION}`}
        >
          {collapsed ? `v${APP_VERSION}` : `Version ${APP_VERSION}`}
        </span>
      )}
    </div>
  );
}
