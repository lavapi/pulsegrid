export interface ServiceCost {
  service: string;
  category: string | null;
  thisMonth: number;
  lastMonth: number;
}

export interface AccountCosts {
  accountId: string;
  accountName: string;
  environmentId: string | null;
  environmentName: string | null;
  isProduction: boolean;
  currency: string | null;
  services: ServiceCost[];
  updatedAt: string | null;
  error: string | null;
}

export interface CostOverview {
  month: string;
  lastMonth: string;
  accounts: AccountCosts[];
}
