'use client';

import type { CurrentUser } from '@pulsegrid/shared';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { LogOut, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSignOut } from '@/components/auth/use-sign-out';

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');

export function UserMenu({ user }: { user: CurrentUser }) {
  const router = useRouter();
  const signOut = useSignOut();

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Account menu"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold transition-colors hover:bg-ring"
      >
        {initialsOf(user.displayName)}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-60 rounded-xl border border-popover-border bg-popover p-1.5 text-sm shadow-2xl shadow-black/30"
        >
          <div className="px-2.5 py-2">
            <p className="truncate font-medium">{user.displayName}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            <p className="mt-1 text-xs text-muted-foreground">{user.roleName}</p>
          </div>
          <Menu.Separator className="my-1 h-px bg-border" />
          <Menu.Item
            onSelect={() => router.push('/account')}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-muted-foreground outline-none data-[highlighted]:bg-ring data-[highlighted]:text-foreground"
          >
            <UserRound className="size-4" aria-hidden="true" />
            Your account
          </Menu.Item>
          <Menu.Item
            onSelect={signOut}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-muted-foreground outline-none data-[highlighted]:bg-ring data-[highlighted]:text-foreground"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
