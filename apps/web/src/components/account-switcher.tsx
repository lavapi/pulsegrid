'use client';

import type { CloudAccount } from '@pulsegrid/shared';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { Check, ChevronsUpDown, Globe2, Loader2 } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useOptimistic, useState, useTransition } from 'react';
import { selectAccount } from '@/app/actions/select-account';
import { EnvironmentBadge } from '@/components/environment-badge';
import { ProviderIcon } from '@/components/provider-icon';
import { environmentLabel } from '@/lib/account-environment';
import { followsAccountSwitcher, pathAfterSwitch, selectedFirst } from '@/lib/account-selection';

const SEARCH_THRESHOLD = 6;
const ALL_ACCOUNT_PATHS = ['/costs', '/environments', '/releases'];

interface SwitcherProps {
  accounts: CloudAccount[];
  selectedId: string | null;
}

export function AccountSwitcher({ accounts, selectedId }: SwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [shownId, showAccount] = useOptimistic(selectedId);
  const selected = accounts.find(({ id }) => id === shownId);

  if (!followsAccountSwitcher(pathname)) {
    const scope = ALL_ACCOUNT_PATHS.some((path) => pathname.startsWith(path))
      ? 'Across all your accounts'
      : null;
    return (
      scope && (
        <span className="inline-flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-[13px] text-muted-foreground">
          <Globe2 className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">{scope}</span>
        </span>
      )
    );
  }
  if (!selected) {
    return null;
  }

  const choose = (accountId: string) => {
    setOpen(false);
    if (accountId === selectedId) {
      return;
    }
    startTransition(async () => {
      showAccount(accountId);
      await selectAccount(accountId);
      const next = pathAfterSwitch(pathname);
      if (next) {
        router.push(next);
      }
      router.refresh();
    });
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={`Cloud account: ${selected.name}, ${environmentLabel(selected)}`}
        disabled={pending}
        className="inline-flex h-9 min-w-0 max-w-[360px] items-center gap-2 rounded-lg border bg-card px-3 font-medium transition-colors hover:bg-muted disabled:opacity-60"
      >
        <ProviderIcon provider={selected.provider} size={18} />
        <span className="hidden truncate sm:inline">{selected.name}</span>
        <span className="hidden text-xs font-normal text-muted-foreground xl:inline">
          {selected.accountId}
        </span>
        <EnvironmentBadge account={selected} />
        {pending ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-faint" aria-hidden="true" />
        ) : (
          <ChevronsUpDown className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-popover-border bg-popover text-sm shadow-2xl shadow-black/30"
        >
          <Command label="Cloud accounts">
            {accounts.length >= SEARCH_THRESHOLD && (
              <Command.Input
                placeholder="Find an account"
                className="h-10 w-full rounded-t-xl border-b bg-transparent px-3 outline-none placeholder:text-faint"
              />
            )}
            <Command.List className="max-h-72 overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-6 text-center text-muted-foreground">
                No matching accounts
              </Command.Empty>
              {selectedFirst(accounts, shownId).map((account) => {
                const { id, name, accountId, provider } = account;
                return (
                  <Command.Item
                    key={id}
                    value={`${name} ${accountId} ${environmentLabel(account)}`}
                    onSelect={() => choose(id)}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 aria-selected:bg-ring"
                  >
                    <ProviderIcon provider={provider} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{name}</span>
                      <span className="block text-xs text-muted-foreground">{accountId}</span>
                    </span>
                    <EnvironmentBadge account={account} />
                    {id === shownId && <Check className="size-4 text-primary" aria-hidden="true" />}
                  </Command.Item>
                );
              })}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
