interface EnvironmentRule {
  name: string;
  sortOrder: number;
  pattern: RegExp;
}

const PRODUCTION_PATTERN = /\b(prod|prd|production|live)\b/i;

const RULES: readonly EnvironmentRule[] = [
  { name: 'Development', sortOrder: 10, pattern: /\b(dev|develop|development)\b/i },
  { name: 'QA', sortOrder: 20, pattern: /\b(qa|test|testing|uat)\b/i },
  { name: 'Staging', sortOrder: 30, pattern: /\b(stage|staging|stg)\b/i },
  { name: 'Production', sortOrder: 40, pattern: PRODUCTION_PATTERN },
];

const PRODUCTION = 'Production';

export const detectEnvironment = (accountName: string): Omit<EnvironmentRule, 'pattern'> | null => {
  const rule = RULES.find(({ pattern }) => pattern.test(accountName));
  return rule ? { name: rule.name, sortOrder: rule.sortOrder } : null;
};

export const isProductionName = (name: string): boolean => detectEnvironment(name)?.name === PRODUCTION;

export const isKnownNonProductionName = (name: string): boolean =>
  detectEnvironment(name) !== null && !PRODUCTION_PATTERN.test(name);
