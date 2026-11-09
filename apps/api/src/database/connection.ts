import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { Database } from './schema';

export const createDatabase = (connectionString: string): Kysely<Database> =>
  new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString, max: 10 }) }),
  });
