import {
  type AwsSecurityFindingFilters,
  GetFindingsCommand,
  type GetFindingsCommandOutput,
  SecurityHubClient,
} from '@aws-sdk/client-securityhub';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { Inject, Injectable } from '@nestjs/common';
import { SECURITY_ALERTS_SETTINGS, type SecurityAlertsSettings } from './security-alerts.settings';

const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const IDS_PER_QUERY = 20;
const SESSION_NAME = 'pulsegrid-security-hub-check';

const UPDATED_FINDINGS: AwsSecurityFindingFilters[] = [
  {
    ProductName: [{ Value: 'GuardDuty', Comparison: 'EQUALS' }],
    SeverityLabel: [
      { Value: 'HIGH', Comparison: 'EQUALS' },
      { Value: 'CRITICAL', Comparison: 'EQUALS' },
    ],
  },
  {
    ProductName: [{ Value: 'Security Hub', Comparison: 'EQUALS' }],
    SeverityLabel: [{ Value: 'CRITICAL', Comparison: 'EQUALS' }],
    ComplianceStatus: [{ Value: 'FAILED', Comparison: 'EQUALS' }],
  },
];

export type ClientFactory = (region: string) => SecurityHubClient;

export const SECURITY_HUB_CLIENTS = Symbol('SECURITY_HUB_CLIENTS');

/** Security Hub clients that act as the read-only role in the Audit account, through PulseGrid's task role. */
export const securityHubClients =
  (settings: SecurityAlertsSettings): ClientFactory =>
  (region) => {
    const sts = new STSClient({ region });
    return new SecurityHubClient({
      region,
      credentials: async () => {
        const { Credentials: credentials } = await sts.send(
          new AssumeRoleCommand({ RoleArn: settings.check?.roleArn, RoleSessionName: SESSION_NAME }),
        );
        if (!credentials?.AccessKeyId || !credentials.SecretAccessKey) {
          throw new Error('AssumeRole returned no credentials');
        }
        return {
          accessKeyId: credentials.AccessKeyId,
          secretAccessKey: credentials.SecretAccessKey,
          sessionToken: credentials.SessionToken,
          expiration: credentials.Expiration,
        };
      },
    });
  };

const chunks = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

/** Reads findings from Security Hub; it never changes anything there. */
@Injectable()
export class SecurityHubReader {
  private readonly clients = new Map<string, SecurityHubClient>();

  constructor(
    @Inject(SECURITY_HUB_CLIENTS) private readonly createClient: ClientFactory,
    @Inject(SECURITY_ALERTS_SETTINGS) private readonly settings: SecurityAlertsSettings,
  ) {}

  /** GuardDuty findings and failed critical checks that changed since the given time, in every region. */
  async updatedSince(since: Date): Promise<unknown[]> {
    const updatedAt = [{ Start: since.toISOString(), End: new Date().toISOString() }];
    return this.everyRegion((client) =>
      Promise.all(UPDATED_FINDINGS.map((filter) => this.all(client, { ...filter, UpdatedAt: updatedAt }))).then(
        (pages) => pages.flat(),
      ),
    );
  }

  /** The current state of these findings, whatever it is now: passed, archived or downgraded included. */
  async byIds(ids: readonly string[]): Promise<unknown[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.everyRegion(async (client) => {
      const found: unknown[] = [];
      for (const batch of chunks(ids, IDS_PER_QUERY)) {
        found.push(...(await this.all(client, { Id: batch.map((Value) => ({ Value, Comparison: 'EQUALS' })) })));
      }
      return found;
    });
  }

  private async everyRegion(read: (client: SecurityHubClient) => Promise<unknown[]>): Promise<unknown[]> {
    const regions = this.settings.check?.regions ?? [];
    return (await Promise.all(regions.map((region) => read(this.client(region))))).flat();
  }

  private client(region: string): SecurityHubClient {
    const existing = this.clients.get(region);
    if (existing) {
      return existing;
    }
    const created = this.createClient(region);
    this.clients.set(region, created);
    return created;
  }

  private async all(client: SecurityHubClient, filters: AwsSecurityFindingFilters): Promise<unknown[]> {
    const findings: unknown[] = [];
    let nextToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const output: GetFindingsCommandOutput = await client.send(
        new GetFindingsCommand({ Filters: filters, MaxResults: PAGE_SIZE, NextToken: nextToken }),
      );
      findings.push(...(output.Findings ?? []));
      nextToken = output.NextToken;
      if (!nextToken) {
        break;
      }
    }
    return findings;
  }
}
