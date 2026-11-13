import { DISPLAY_NAME_MAX_LENGTH, isRenamable, type Resource } from '@pulsegrid/shared';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuthContext } from '../../auth/session/auth-context';
import { TenantDatabase } from '../../database/tenant-database';
import { ResourceAccess } from './resource-access';
import { ResourcesService } from './resources.service';

const NOT_RENAMABLE = "This kind of resource can't be given a display name.";
const TOO_LONG = `A display name can be up to ${DISPLAY_NAME_MAX_LENGTH} characters.`;

/** Display names given in PulseGrid. They change nothing in the cloud, and follow the resource's cloud id. */
@Injectable()
export class DisplayNamesService {
  constructor(
    private readonly access: ResourceAccess,
    private readonly resources: ResourcesService,
    private readonly database: TenantDatabase,
  ) {}

  /** Gives the resource a display name; an empty one, or the cloud's own name, removes it. */
  async rename(auth: AuthContext, id: string, wanted: string, ipAddress: string | undefined): Promise<Resource> {
    const resource = await this.resources.get(auth, id);
    if (!isRenamable(resource.type)) {
      throw new BadRequestException(NOT_RENAMABLE);
    }
    const displayName = wanted.trim();
    if (displayName.length > DISPLAY_NAME_MAX_LENGTH) {
      throw new BadRequestException(TOO_LONG);
    }
    const next = displayName && displayName !== resource.name ? displayName : null;
    if (next === resource.displayName) {
      return resource;
    }
    await this.database.run(auth.tenantId, async (trx) => {
      if (next) {
        await trx
          .insertInto('resource_display_names')
          .values({
            tenant_id: auth.tenantId,
            cloud_account_id: resource.cloudAccount.id,
            native_id: resource.nativeId,
            display_name: next,
            updated_by_email: auth.email,
          })
          .onConflict((conflict) =>
            conflict.columns(['cloud_account_id', 'native_id']).doUpdateSet({
              display_name: next,
              updated_by_email: auth.email,
              updated_at: new Date(),
            }),
          )
          .execute();
      } else {
        await trx
          .deleteFrom('resource_display_names')
          .where('cloud_account_id', '=', resource.cloudAccount.id)
          .where('native_id', '=', resource.nativeId)
          .execute();
      }
    });
    await this.access.record(auth, next ? 'resource.renamed' : 'resource.name_reset', id, ipAddress, {
      label: resource.name,
      from: resource.displayName ?? resource.name,
      to: next ?? resource.name,
    });
    return this.resources.get(auth, id);
  }
}
