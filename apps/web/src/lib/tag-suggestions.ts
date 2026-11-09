import { passesTagFilter, type TagFilter, type TagRule } from '@pulsegrid/shared';

const AWS_MANAGED_PREFIX = 'aws:';

export interface TagSuggestion {
  key: string;
  values: string[];
}

export const tagSuggestions = (tagSets: readonly Record<string, string>[]): TagSuggestion[] => {
  const found = new Map<string, Set<string>>();
  tagSets.flatMap(Object.entries).forEach(([key, value]) => {
    if (!key.startsWith(AWS_MANAGED_PREFIX)) {
      found.set(key, (found.get(key) ?? new Set()).add(value));
    }
  });
  return [...found.entries()]
    .map(([key, values]) => ({ key, values: [...values].sort() }))
    .sort((first, second) => first.key.localeCompare(second.key));
};

export const keptCount = (tagSets: readonly Record<string, string>[], filter: TagFilter): number =>
  tagSets.filter((tags) => passesTagFilter(filter, tags)).length;

const cleanRules = (rules: readonly TagRule[]): TagRule[] =>
  rules.flatMap(({ key, value }) => {
    const name = key.trim();
    return name ? [{ key: name, value: value?.trim() || null }] : [];
  });

export const cleanTagFilter = ({ include, exclude, keepUntagged }: TagFilter): TagFilter => ({
  include: cleanRules(include),
  exclude: cleanRules(exclude),
  keepUntagged,
});
