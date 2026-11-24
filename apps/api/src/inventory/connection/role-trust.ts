import { createHmac } from 'node:crypto';
import type { RoleTrustDetails } from '@pulsegrid/shared';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';

const EXTERNAL_ID_LENGTH = 32;
const ROLE_ARN = /^arn:aws[a-z-]*:iam::\d{12}:role\/[\w+=,.@/-]+$/;


/**
 * What a role needs to trust PulseGrid: its task roles, and each project's External ID, so that only this project
 * can make PulseGrid take on the role. The ID is derived from the server's secret: stable, never stored, unguessable.
 */
@Injectable()
export class RoleTrust {
  private readonly principals: string[];

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.principals = (process.env['PULSEGRID_TASK_ROLE_ARNS'] ?? '')
      .split(',')
      .map((arn) => arn.trim())
      .filter((arn) => ROLE_ARN.test(arn));
  }

  externalId(tenantId: string): string {
    const digest = createHmac('sha256', this.config.tokenEncryptionKey)
      .update(`external-id:${tenantId}`)
      .digest('base64url');
    return `pulsegrid-${digest.slice(0, EXTERNAL_ID_LENGTH)}`;
  }

  details(tenantId: string): RoleTrustDetails {
    return { externalId: this.externalId(tenantId), principals: this.principals };
  }
}
