import { z } from 'zod';
import { createDatabase } from './connection';
import { runMigrations } from './migrate';

const env = z
  .object({ MIGRATION_DATABASE_URL: z.string().min(1), APP_DB_PASSWORD: z.string().min(1) })
  .parse(process.env);

const db = createDatabase(env.MIGRATION_DATABASE_URL);

runMigrations(db, env.APP_DB_PASSWORD)
  .then(() => console.log('Database is up to date.'))
  .catch((error: unknown) => {
    console.error('Migration failed.', error);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
