import type { ResourceHealth } from '@pulsegrid/shared';

export const collectPages = async <Page, Item>(
  pages: AsyncIterable<Page>,
  pick: (page: Page) => Item[] | undefined,
): Promise<Item[]> => {
  const items: Item[] = [];
  for await (const page of pages) {
    items.push(...(pick(page) ?? []));
  }
  return items;
};

export const optional = <Item>(items: Promise<Item[]>): Promise<Item[]> => items.catch(() => []);

export const tagMap = (
  tags: readonly { Key?: string | undefined; Value?: string | undefined }[] | undefined,
): Record<string, string> =>
  Object.fromEntries((tags ?? []).flatMap((tag) => (tag.Key ? [[tag.Key, tag.Value ?? '']] : [])));

export const safeTags = async (
  read: () => Promise<Record<string, string>>,
): Promise<Record<string, string>> => {
  try {
    return await read();
  } catch {
    return {};
  }
};

export interface HealthRules {
  healthy: readonly string[];
  stopped?: readonly string[];
  degraded?: readonly string[];
}

export const healthFrom = (status: string, rules: HealthRules): ResourceHealth => {
  const value = status.toLowerCase();
  if (rules.healthy.includes(value)) {
    return 'healthy';
  }
  if (rules.stopped?.includes(value)) {
    return 'stopped';
  }
  return rules.degraded?.includes(value) ? 'degraded' : 'unknown';
};
