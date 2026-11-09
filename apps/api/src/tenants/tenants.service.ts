import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { DATABASE } from '../database/database.module';
import type { Database, Tenant } from '../database/schema';

@Injectable()
export class TenantsService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async findBySlug(slug: string): Promise<Tenant | null> {
    const tenant = await this.db
      .selectFrom('tenants')
      .selectAll()
      .where('slug', '=', slug)
      .executeTakeFirst();
    return tenant ?? null;
  }

  async findById(id: string): Promise<Tenant | null> {
    const tenant = await this.db
      .selectFrom('tenants')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return tenant ?? null;
  }
}
