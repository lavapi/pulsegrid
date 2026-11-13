'use client';

import {
  type Resource,
  type ResourcePage,
  resourcePath,
  resourceTypeLabel,
  SERVICE_CATEGORIES,
  type ServiceCategory,
  shownName,
} from '@pulsegrid/shared';
import { Command } from 'cmdk';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ServiceIcon } from '@/components/service-icon';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { apiSendForJson } from '@/lib/browser-api';
import { allowedNav, MAIN_NAV, type NavAccess, SETTINGS_NAV } from '@/lib/navigation';

const SEARCH_DELAY_MS = 200;
const MAX_RESULTS = '8';
const CATEGORIES = Object.keys(SERVICE_CATEGORIES) as ServiceCategory[];
const ITEM =
  'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 aria-selected:bg-ring';
const GROUP =
  '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-faint';

const useResourceSearch = (query: string, accountId: string | null): Resource[] => {
  const [resources, setResources] = useState<Resource[]>([]);

  useEffect(() => {
    const term = query.trim();
    if (!term || !accountId) {
      setResources([]);
      return;
    }
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ q: term, account: accountId, limit: MAX_RESULTS });
      const { data } = await apiSendForJson<ResourcePage>(`/resources?${params}`, 'GET');
      setResources(data?.resources ?? []);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, accountId]);

  return resources;
};

export function CommandMenu({
  open,
  onOpenChange,
  accountId,
  access,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string | null;
  access: NavAccess;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const resources = useResourceSearch(query, accountId);

  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', toggle);
    return () => window.removeEventListener('keydown', toggle);
  }, [onOpenChange, open]);

  const go = (href: string) => {
    onOpenChange(false);
    setQuery('');
    router.push(href);
  };

  const pages = allowedNav([...MAIN_NAV, ...SETTINGS_NAV], access);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[20%] max-w-xl translate-y-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <Command label="Search" loop>
          <div className="flex items-center gap-2.5 border-b px-4">
            <Search className="size-4 text-faint" aria-hidden="true" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search services, resources and pages"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
            />
          </div>
          <Command.List className="max-h-96 overflow-y-auto p-2 text-sm">
            <Command.Empty className="py-8 text-center text-muted-foreground">
              No results
            </Command.Empty>
            {resources.length > 0 && (
              <Command.Group heading="Resources" className={GROUP}>
                {resources.map((resource) => (
                  <Command.Item
                    key={resource.id}
                    value={`${query} ${resource.id}`}
                    onSelect={() => go(resourcePath(resource))}
                    className={ITEM}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {shownName(resource)}
                      {resource.displayName && (
                        <span className="text-xs text-muted-foreground"> · {resource.name}</span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {resourceTypeLabel(resource.type)}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            <Command.Group heading="Services" className={GROUP}>
              {CATEGORIES.map((category) => (
                <Command.Item
                  key={category}
                  value={`service ${SERVICE_CATEGORIES[category].label}`}
                  onSelect={() => go(`/infrastructure/${category}`)}
                  className={ITEM}
                >
                  <ServiceIcon category={category} size={20} />
                  {SERVICE_CATEGORIES[category].label}
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading="Pages" className={GROUP}>
              {pages.map(({ href, label, icon: Icon }) => (
                <Command.Item
                  key={href}
                  value={`page ${label}`}
                  onSelect={() => go(href)}
                  className={ITEM}
                >
                  <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  {label}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
