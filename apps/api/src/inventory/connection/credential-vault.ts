import { Injectable } from '@nestjs/common';
import type { CloudAccountRow } from '../../database/schema';
import type { CloudCredentials } from '../providers/provider';
import { TokenCipher } from './token-cipher';

type SealedAccount = Pick<
  CloudAccountRow,
  'tenant_id' | 'provider' | 'account_id' | 'encrypted_credentials'
>;

const contextFor = ({ tenant_id: tenantId, provider, account_id: accountId }: SealedAccount): string =>
  `${provider}-key:${tenantId}:${accountId}`;

@Injectable()
export class CredentialVault {
  constructor(private readonly cipher: TokenCipher) {}

  seal(account: Omit<SealedAccount, 'encrypted_credentials'>, credentials: CloudCredentials): string {
    return this.cipher.encrypt(credentials, contextFor({ ...account, encrypted_credentials: null }));
  }

  open(account: SealedAccount): CloudCredentials | null {
    const sealed = account.encrypted_credentials;
    return sealed ? this.cipher.decrypt<CloudCredentials>(sealed, contextFor(account)) : null;
  }
}
