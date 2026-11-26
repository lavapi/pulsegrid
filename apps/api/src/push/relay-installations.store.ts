import { Inject, Injectable } from '@nestjs/common';
import type { RelayInstallation } from '@pulsegrid/push';
import type { Kysely } from 'kysely';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/schema';
import { TokenCipher } from '../inventory/connection/token-cipher';
import type { RelayInstallations } from './relay-client';

const CONTEXT = 'push-relay-installation';

/** This server's ID and secret at each push relay it has registered with, the secret kept encrypted. */
@Injectable()
export class RelayInstallationsStore implements RelayInstallations {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    private readonly cipher: TokenCipher,
  ) {}

  async find(relayUrl: string): Promise<RelayInstallation | null> {
    const row = await this.db
      .selectFrom('push_relay_installations')
      .select(['installation_id', 'secret_encrypted'])
      .where('relay_url', '=', relayUrl)
      .executeTakeFirst();
    return row
      ? { installationId: row.installation_id, secret: this.cipher.decrypt<string>(row.secret_encrypted, CONTEXT) }
      : null;
  }

  async save(relayUrl: string, { installationId, secret }: RelayInstallation): Promise<void> {
    const values = { installation_id: installationId, secret_encrypted: this.cipher.encrypt(secret, CONTEXT) };
    await this.db
      .insertInto('push_relay_installations')
      .values({ relay_url: relayUrl, ...values })
      .onConflict((conflict) => conflict.column('relay_url').doUpdateSet(values))
      .execute();
  }

  async forget(relayUrl: string): Promise<void> {
    await this.db.deleteFrom('push_relay_installations').where('relay_url', '=', relayUrl).execute();
  }
}
