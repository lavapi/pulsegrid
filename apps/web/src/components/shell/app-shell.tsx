'use client';

import type { CloudAccount, CurrentUser, Project } from '@pulsegrid/shared';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Menu, PanelLeft, Search } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { AccountSwitcher } from '@/components/account-switcher';
import { Button } from '@/components/ui/button';
import { followsAccountSwitcher } from '@/lib/account-selection';
import { ProductionAccountProvider } from '@/lib/production-account';
import { cn } from '@/lib/utils';
import { CommandMenu } from './command-menu';
import { Sidebar } from './sidebar';
import { ThemeToggle } from './theme-toggle';
import { TimeModeToggle } from './time-mode-toggle';
import { UserMenu } from './user-menu';

const COLLAPSED_KEY = 'devdash-sidebar-collapsed';

const readCollapsed = (): boolean => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
};

const saveCollapsed = (collapsed: boolean): void => {
  try {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed));
  } catch {
    // The choice simply isn't remembered when storage is unavailable.
  }
};

interface AppShellProps {
  user: CurrentUser;
  projects: Project[];
  accounts: CloudAccount[];
  selectedId: string | null;
  children: ReactNode;
}

export function AppShell({ user, projects, accounts, selectedId, children }: AppShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const selected = accounts.find(({ id }) => id === selectedId);
  const production = selected?.isProduction && followsAccountSwitcher(pathname) ? selected : null;

  useEffect(() => setCollapsed(readCollapsed()), []);

  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
    saveCollapsed(!collapsed);
  };

  return (
    <ProductionAccountProvider account={production ?? null}>
      <div
        className={cn(
          'grid min-h-screen grid-cols-1 print:block',
          collapsed ? 'lg:grid-cols-[64px_minmax(0,1fr)]' : 'lg:grid-cols-[248px_minmax(0,1fr)]',
        )}
      >
        <aside
          className={cn(
            'sticky hidden overflow-y-auto border-r bg-sidebar lg:block print:hidden',
            'top-0 h-screen',
          )}
        >
          <Sidebar user={user} projects={projects} collapsed={collapsed} />
        </aside>

        <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 lg:hidden" />
            <DialogPrimitive.Content
              aria-describedby={undefined}
              className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] overflow-y-auto border-r bg-sidebar focus:outline-none lg:hidden"
            >
              <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
              <Sidebar
                user={user}
                projects={projects}
                onNavigate={() => setMobileOpen(false)}
              />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>

        <div className="flex min-w-0 flex-col">
          <header
            className={cn(
              'sticky z-40 flex h-[60px] items-center gap-2 border-b bg-background/85 px-4 backdrop-blur lg:px-6 print:hidden',
              'top-0',
              production && 'border-t-[3px] border-t-production print:border-t-0',
            )}
          >
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="hidden lg:inline-flex"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={toggleCollapsed}
            >
              <PanelLeft />
            </Button>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Search"
              className="flex h-9 max-w-md flex-1 items-center gap-2 rounded-lg border bg-card px-3 text-faint transition-colors hover:bg-muted max-sm:w-9 max-sm:max-w-9 max-sm:flex-none max-sm:justify-center max-sm:px-0"
            >
              <Search className="size-4 shrink-0" aria-hidden="true" />
              <span className="flex-1 truncate text-left max-sm:hidden">
                Search services and resources
              </span>
              <kbd className="rounded border px-1.5 text-[11px] font-medium text-muted-foreground max-sm:hidden">
                ⌘K
              </kbd>
            </button>
            <span className="flex-1" />
            <AccountSwitcher accounts={accounts} selectedId={selectedId} />
            <TimeModeToggle />
            <ThemeToggle />
            <UserMenu user={user} />
          </header>
          <main className="mx-auto flex w-full max-w-[1320px] flex-col gap-6 px-4 py-6 lg:px-8 lg:py-7">
            {children}
          </main>
        </div>

        <CommandMenu
          open={searchOpen}
          onOpenChange={setSearchOpen}
          accountId={selectedId}
          access={user}
        />
      </div>
    </ProductionAccountProvider>
  );
}
