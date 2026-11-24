import { Injectable } from '@nestjs/common';
import type { CloudAccountRow } from '../../database/schema';
import type { CloudCredentials } from '../providers/provider';
import { ProviderRegistry } from '../providers/provider-registry';
import { CredentialVault } from './credential-vault';

type ConnectedAccount = Pick<CloudAccountRow, 'tenant_id' | 'provider' | 'account_id' | 'encrypted_credentials'>;

/**
 * Credentials to call a cloud account with, made from what's stored for it: a key as it is, or a role's temporary
 * credentials, so nothing outside the provider needs to know which.
 */
@Injectable()
export class AccountCredentials {
  constructor(
    private readonly vault: CredentialVault,
    private readonly providers: ProviderRegistry,
  ) {}

  async of(account: ConnectedAccount): Promise<CloudCredentials | null> {
    const stored = this.vault.open(account);
    if (!stored) {
      return null;
    }
    const provider = this.providers.get(account.provider);
    return provider.resolveCredentials ? provider.resolveCredentials(stored) : stored;
  }
}
