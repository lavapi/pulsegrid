export interface TagRule {
  key: string;
  value: string | null;
}

export interface TagFilter {
  include: TagRule[];
  exclude: TagRule[];
  keepUntagged: boolean;
}

export const EMPTY_TAG_FILTER: TagFilter = { include: [], exclude: [], keepUntagged: false };

const matchesRule = ({ key, value }: TagRule, tags: Record<string, string>): boolean =>
  Object.hasOwn(tags, key) && (value === null || tags[key] === value);

export const passesTagFilter = (
  { include, exclude, keepUntagged }: TagFilter,
  tags: Record<string, string>,
): boolean => {
  if (exclude.some((rule) => matchesRule(rule, tags))) {
    return false;
  }
  if (include.length === 0) {
    return true;
  }
  if (Object.keys(tags).length === 0) {
    return keepUntagged;
  }
  return include.some((rule) => matchesRule(rule, tags));
};

export interface AccountTagSummary {
  tagSets: Record<string, string>[];
}
