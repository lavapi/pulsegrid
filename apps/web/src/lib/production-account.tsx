'use client';

import type { CloudAccount } from '@pulsegrid/shared';
import { createContext, type ReactNode, useContext } from 'react';

const ProductionAccount = createContext<CloudAccount | null>(null);

/** The selected account when it's production and the page acts on it, so action dialogs can warn. */
export function ProductionAccountProvider({ account, children }: { account: CloudAccount | null; children: ReactNode }) {
  return <ProductionAccount.Provider value={account}>{children}</ProductionAccount.Provider>;
}

export const useProductionAccount = (): CloudAccount | null => useContext(ProductionAccount);
