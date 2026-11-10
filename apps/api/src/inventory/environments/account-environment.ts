import { isKnownNonProductionName } from './environment-detection';

export interface AccountEnvironment {
  name: string;
  isProduction: boolean;
}

export const toAccountEnvironment = (
  name: string | null,
  isProduction: boolean | null,
): AccountEnvironment | null => (name === null ? null : { name, isProduction: isProduction ?? true });

export const newEnvironment = (tenantId: string, name: string, sortOrder?: number) => ({
  tenant_id: tenantId,
  name,
  sort_order: sortOrder,
  is_production: !isKnownNonProductionName(name),
});
