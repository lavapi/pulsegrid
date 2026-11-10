import { z } from 'zod';
import { createDatabase } from '../connection';
import { type TenantTransaction, withTenantContext } from '../tenant-context';
import { currentMonth, previousMonth } from '../../inventory/costs/cost-months';
import { newEnvironment } from '../../inventory/environments/account-environment';
import { type DemoStack, demoResources } from './demo-resources';

const STACKS: (DemoStack & { environment: string; host: string; costScale: number })[] = [
  {
    environment: 'Staging',
    stage: 'staging',
    accountId: '111111111111',
    region: 'eu-central-1',
    cidrPrefix: '10.10',
    appTasks: 1,
    deploying: 'api',
    host: 'staging.acme.example.com',
    costScale: 0.4,
  },
  {
    environment: 'Production',
    stage: 'production',
    accountId: '222222222222',
    region: 'eu-central-1',
    cidrPrefix: '10.20',
    appTasks: 3,
    deploying: null,
    host: 'acme.example.com',
    costScale: 1,
  },
];

const MONTHLY_COSTS: Record<string, [string | null, number]> = {
  ECS: ['ecs', 182.4],
  RDS: ['rds', 241.75],
  ElastiCache: ['elasticache', 64.2],
  'Load balancing': ['load-balancing', 38.9],
  VPC: ['vpc', 32.4],
  S3: ['s3', 11.3],
  'Secrets Manager': ['secrets-manager', 1.6],
  'Amazon CloudWatch': [null, 14.85],
};

const env = z.object({ MIGRATION_DATABASE_URL: z.string().min(1) }).parse(process.env);
const projectName = process.argv[2];

const findProject = async (db: ReturnType<typeof createDatabase>) => {
  const query = db.selectFrom('tenants').select(['id', 'name']).orderBy('created_at');
  const project = await (projectName ? query.where('name', '=', projectName) : query).executeTakeFirst();
  if (!project) throw new Error('Create a project in the setup wizard first, then run this again.');
  return project;
};

const assertEmpty = async (trx: TenantTransaction, tenantId: string) => {
  const existing = await trx
    .selectFrom('cloud_accounts')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst();
  if (existing) throw new Error('This project already has cloud accounts. Demo data only goes into an empty project.');
};

const seedStack = async (trx: TenantTransaction, tenantId: string, stack: (typeof STACKS)[number], order: number) => {
  const now = new Date();
  const environment = await trx
    .insertInto('environments')
    .values(newEnvironment(tenantId, stack.environment, order))
    .onConflict((conflict) => conflict.columns(['tenant_id', 'name']).doUpdateSet({ sort_order: order }))
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('environment_domains')
    .values([
      { tenant_id: tenantId, environment_id: environment.id, kind: 'app', label: 'App', url: `https://${stack.host}` },
      { tenant_id: tenantId, environment_id: environment.id, kind: 'grafana', label: 'Grafana', url: `https://grafana.${stack.host}` },
    ])
    .execute();
  const account = await trx
    .insertInto('cloud_accounts')
    .values({
      tenant_id: tenantId,
      provider: 'aws',
      account_id: stack.accountId,
      name: `Acme ${stack.environment}`,
      regions: [stack.region],
      status: 'connected',
      last_synced_at: now,
      credential_hint: 'AKIA…DEMO',
      can_write: false,
      environment_id: environment.id,
      environment_reviewed: true,
      costs_checked_at: now,
      costs_updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('resources')
    .values(
      demoResources(stack).map((resource) => ({
        tenant_id: tenantId,
        cloud_account_id: account.id,
        region: stack.region,
        type: resource.type,
        service: resource.service,
        native_id: resource.nativeId,
        name: resource.name,
        status: resource.status,
        health: resource.health,
        tags: JSON.stringify(resource.tags),
        details: JSON.stringify(resource.details),
        last_seen_at: now,
      })),
    )
    .execute();
  await trx
    .insertInto('cloud_costs')
    .values(
      [previousMonth(now), currentMonth(now)].flatMap((month, index) =>
        Object.entries(MONTHLY_COSTS).map(([service, [category, amount]]) => ({
          tenant_id: tenantId,
          cloud_account_id: account.id,
          month,
          service,
          category,
          amount: Math.round(amount * stack.costScale * (index === 0 ? 1 : 0.34) * 100) / 100,
          currency: 'USD',
        })),
      ),
    )
    .execute();
};

const main = async () => {
  const db = createDatabase(env.MIGRATION_DATABASE_URL);
  try {
    const project = await findProject(db);
    await withTenantContext(db, project.id, async (trx) => {
      await assertEmpty(trx, project.id);
      for (const [order, stack] of STACKS.entries()) await seedStack(trx, project.id, stack, order);
    });
    console.log(`Added demo data to ${project.name}.`);
  } finally {
    await db.destroy();
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Adding demo data failed.');
  process.exitCode = 1;
});
