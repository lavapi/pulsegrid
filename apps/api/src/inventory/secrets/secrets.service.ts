import type { SecretContent, SecretView } from '@pulsegrid/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuthContext } from '../../auth/session/auth-context';
import { CredentialVault } from '../connection/credential-vault';
import type { CloudProvider, SecretContext, SecretStore } from '../providers/provider';
import { ProviderRegistry } from '../providers/provider-registry';
import { ResourceAccess } from '../resources/resource-access';
import {
  applyChange,
  type ChangeProblem,
  entryText,
  keyChanges,
  parseSecret,
  type SecretChange as DocumentChange,
  type SecretDocument,
  withoutEntry,
} from './secret-document';
import { secretAccess } from './secret-rules';

const NOT_A_SECRET = "That resource isn't a secret.";
const NOT_ALLOWED = 'You do not have permission to do that.';
const NO_CREDENTIALS = 'This account has no access key. Add one under Integrations.';
const CHANGED = 'This secret changed since you opened it. Reload the page and try again.';
const KEY_MISSING = 'That key no longer exists. Reload the page.';
const WRONG_FORMAT = "That change doesn't match this secret any more. Reload the page.";
const KEY_EXISTS = 'That key already exists. Choose another name.';
const INVALID_JSON = 'This value has to stay valid JSON.';
const NOT_AN_OBJECT = 'This secret has to stay a valid JSON object.';

const CHANGE_ERRORS: Record<ChangeProblem, () => Error> = {
  wrongFormat: () => new BadRequestException(WRONG_FORMAT),
  keyMissing: () => new NotFoundException(KEY_MISSING),
  keyExists: () => new ConflictException(KEY_EXISTS),
  invalidJson: () => new BadRequestException(INVALID_JSON),
  notAnObject: () => new BadRequestException(NOT_AN_OBJECT),
};

export interface SecretKeyRequest {
  key: string | null;
}

export interface SecretChange extends DocumentChange {
  versionId: string;
}

export interface SecretKeyRemoval {
  key: string;
  versionId: string;
}

interface SecretTarget {
  provider: CloudProvider;
  store: SecretStore;
  context: SecretContext;
  metadata: Record<string, unknown>;
}

@Injectable()
export class SecretsService {
  private readonly logger = new Logger(SecretsService.name);

  constructor(
    private readonly access: ResourceAccess,
    private readonly providers: ProviderRegistry,
    private readonly vault: CredentialVault,
  ) {}

  async view(auth: AuthContext, id: string): Promise<SecretView> {
    const { rules, target } = await this.open(auth, id);
    if (!rules.canRead) {
      return { access: rules, content: null, error: null };
    }
    try {
      const { value, versionId } = await this.read(target());
      return { access: rules, content: toContent(parseSecret(value), versionId), error: null };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException) {
        return { access: rules, content: null, error: error.message };
      }
      throw error;
    }
  }

  async reveal(
    auth: AuthContext,
    id: string,
    { key }: SecretKeyRequest,
    ipAddress: string | undefined,
  ): Promise<{ value: string }> {
    const { rules, target } = await this.open(auth, id);
    if (!rules.canRead) {
      await this.deny(auth, id, ipAddress, key);
      throw new ForbiddenException(rules.reason ?? NOT_ALLOWED);
    }
    const secret = target();
    const { value } = await this.read(secret);
    const { entries } = parseSecret(value);
    const shown = entries && key !== null ? entryText(entries, key) : key === null ? value : null;
    if (shown === null) {
      throw new NotFoundException(KEY_MISSING);
    }
    await this.access.record(auth, 'secret.value_read', id, ipAddress, { ...secret.metadata, key });
    return { value: shown };
  }

  async save(
    auth: AuthContext,
    id: string,
    { versionId, ...change }: SecretChange,
    ipAddress: string | undefined,
  ): Promise<void> {
    const { key, name } = change;
    const secret = await this.writable(auth, id, name, ipAddress);
    const document = await this.current(secret, versionId);
    const result = applyChange(document, change);
    if ('problem' in result) {
      throw CHANGE_ERRORS[result.problem]();
    }
    await this.write(secret, result.text);
    const replaced = document.entries && name === null ? document.entries : null;
    await this.access.record(auth, 'secret.key_saved', id, ipAddress, {
      ...secret.metadata,
      ...(replaced
        ? keyChanges(replaced, JSON.parse(result.text) as Record<string, unknown>)
        : { key: name }),
      ...(key !== null && key !== name ? { previousKey: key } : {}),
    });
  }

  async remove(
    auth: AuthContext,
    id: string,
    { key, versionId }: SecretKeyRemoval,
    ipAddress: string | undefined,
  ): Promise<void> {
    const secret = await this.writable(auth, id, key, ipAddress);
    const { entries } = await this.current(secret, versionId);
    if (!entries || entryText(entries, key) === null) {
      throw new NotFoundException(KEY_MISSING);
    }
    await this.write(secret, withoutEntry(entries, key));
    await this.access.record(auth, 'secret.key_deleted', id, ipAddress, { ...secret.metadata, key });
  }

  private async open(auth: AuthContext, id: string) {
    const { resource, account, environment, granted } = await this.access.load(auth, id);
    const provider = this.providers.get(account.provider);
    const store = provider.secretStore;
    if (!store || store.resourceType !== resource.type) {
      throw new NotFoundException(NOT_A_SECRET);
    }
    const rules = secretAccess({
      granted,
      environment,
      managedBy: resource.details['managedBy'],
    });
    const target = (): SecretTarget => {
      const credentials = this.vault.open(account);
      if (!credentials) {
        throw new ConflictException(NO_CREDENTIALS);
      }
      return {
        provider,
        store,
        context: { credentials, region: resource.region, secretId: resource.native_id },
        metadata: { label: resource.name, cloudAccount: account.account_id },
      };
    };
    return { rules, target };
  }

  private async writable(
    auth: AuthContext,
    id: string,
    key: string | null,
    ipAddress: string | undefined,
  ): Promise<SecretTarget> {
    const { rules, target } = await this.open(auth, id);
    if (!rules.canWrite) {
      await this.deny(auth, id, ipAddress, key);
      throw new ForbiddenException(rules.reason ?? NOT_ALLOWED);
    }
    return target();
  }

  private deny(
    auth: AuthContext,
    id: string,
    ipAddress: string | undefined,
    key: string | null,
  ): Promise<void> {
    return this.access.record(auth, 'access.denied', id, ipAddress, { permission: 'secret', key });
  }

  private read({ provider, store, context }: SecretTarget) {
    return store.read(context).catch((error: unknown) => {
      throw new BadRequestException(this.failure(provider, error));
    });
  }

  private async current(secret: SecretTarget, versionId: string): Promise<SecretDocument> {
    const stored = await this.read(secret);
    if (stored.versionId !== versionId) {
      throw new ConflictException(CHANGED);
    }
    const document = parseSecret(stored.value);
    if (document.format === 'binary') {
      throw new BadRequestException(WRONG_FORMAT);
    }
    return document;
  }

  private write({ provider, store, context }: SecretTarget, value: string): Promise<void> {
    return store.write(context, value).catch((error: unknown) => {
      throw new BadRequestException(this.failure(provider, error));
    });
  }

  private failure(provider: CloudProvider, error: unknown): string {
    this.logger.warn(`Secret request failed: ${(error as Error).name}`);
    return provider.actionFailureMessage(error);
  }
}

const toContent = ({ format, entries }: SecretDocument, versionId: string): SecretContent => ({
  format,
  keys: Object.keys(entries ?? {}).sort(),
  versionId,
});
