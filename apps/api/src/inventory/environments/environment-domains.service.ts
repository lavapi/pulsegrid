import type { DomainKind, EnvironmentDomain } from '@pulsegrid/shared';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { AuthContext } from '../../auth/session/auth-context';
import { isUniqueViolation } from '../../database/errors';
import type { TenantTransaction } from '../../database/tenant-context';
import { TenantDatabase } from '../../database/tenant-database';
import { domainsOf, normalizeDomainUrl } from './environment-domains';

const ENVIRONMENT_MISSING = 'That environment no longer exists.';
const DOMAIN_MISSING = 'That domain no longer exists.';
const INVALID_ADDRESS = 'Enter a web address like staging.example.com.';
const DUPLICATE_ADDRESS = 'That address is already on this environment.';
const DOMAIN_FIELDS = ['id', 'kind', 'label', 'url'] as const;

export interface DomainInput {
  kind: DomainKind;
  label: string | null;
  url: string;
}

interface DomainChange {
  action: string;
  environmentId: string;
  domain: Pick<EnvironmentDomain, 'id' | 'kind' | 'url'>;
  previousUrl?: string;
}

const addressOf = (url: string): string => {
  const address = normalizeDomainUrl(url);
  if (!address) {
    throw new BadRequestException(INVALID_ADDRESS);
  }
  return address;
};

const friendlyDuplicates = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictException(DUPLICATE_ADDRESS);
    }
    throw error;
  }
};

@Injectable()
export class EnvironmentDomainsService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, environmentId: string): Promise<EnvironmentDomain[]> {
    return this.database.run(tenantId, async (trx) => {
      await this.environmentName(trx, environmentId);
      return domainsOf(trx, environmentId);
    });
  }

  add(
    auth: AuthContext,
    environmentId: string,
    { kind, label, url }: DomainInput,
    ipAddress: string | undefined,
  ): Promise<EnvironmentDomain> {
    const address = addressOf(url);
    return friendlyDuplicates(() =>
      this.database.run(auth.tenantId, async (trx) => {
        await this.environmentName(trx, environmentId);
        const domain = await trx
          .insertInto('environment_domains')
          .values({ tenant_id: auth.tenantId, environment_id: environmentId, kind, label, url: address })
          .returning(DOMAIN_FIELDS)
          .executeTakeFirstOrThrow();
        await this.record(trx, auth, ipAddress, { action: 'environment.domain_added', environmentId, domain });
        return domain;
      }),
    );
  }

  update(
    auth: AuthContext,
    id: string,
    { kind, label, url }: DomainInput,
    ipAddress: string | undefined,
  ): Promise<EnvironmentDomain> {
    const address = addressOf(url);
    return friendlyDuplicates(() =>
      this.database.run(auth.tenantId, async (trx) => {
        const previous = await trx
          .selectFrom('environment_domains')
          .select(['environment_id', 'url'])
          .where('id', '=', id)
          .executeTakeFirst();
        if (!previous) {
          throw new NotFoundException(DOMAIN_MISSING);
        }
        const domain = await trx
          .updateTable('environment_domains')
          .set({ kind, label, url: address })
          .where('id', '=', id)
          .returning(DOMAIN_FIELDS)
          .executeTakeFirstOrThrow();
        await this.record(trx, auth, ipAddress, {
          action: 'environment.domain_updated',
          environmentId: previous.environment_id,
          domain,
          previousUrl: previous.url,
        });
        return domain;
      }),
    );
  }

  remove(auth: AuthContext, id: string, ipAddress: string | undefined): Promise<void> {
    return this.database.run(auth.tenantId, async (trx) => {
      const domain = await trx
        .deleteFrom('environment_domains')
        .where('id', '=', id)
        .returning(['id', 'kind', 'url', 'environment_id'])
        .executeTakeFirst();
      if (!domain) {
        throw new NotFoundException(DOMAIN_MISSING);
      }
      await this.record(trx, auth, ipAddress, {
        action: 'environment.domain_removed',
        environmentId: domain.environment_id,
        domain,
      });
    });
  }

  private async environmentName(trx: TenantTransaction, id: string): Promise<string> {
    const environment = await trx
      .selectFrom('environments')
      .select('name')
      .where('id', '=', id)
      .executeTakeFirst();
    if (!environment) {
      throw new NotFoundException(ENVIRONMENT_MISSING);
    }
    return environment.name;
  }

  private async record(
    trx: TenantTransaction,
    auth: AuthContext,
    ipAddress: string | undefined,
    { action, environmentId, domain, previousUrl }: DomainChange,
  ): Promise<void> {
    await this.audit.record(trx, {
      tenantId: auth.tenantId,
      action,
      actor: { userId: auth.userId, email: auth.email },
      target: { type: 'environment_domain', id: domain.id },
      ipAddress,
      metadata: {
        label: domain.url,
        environment: await this.environmentName(trx, environmentId),
        kind: domain.kind,
        ...(previousUrl && previousUrl !== domain.url ? { previous: previousUrl } : {}),
      },
    });
  }
}
