import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { CLOUD_PROVIDER_LIST, type CloudProvider } from './provider';

const UNKNOWN_PROVIDER = "That cloud provider isn't available.";

@Injectable()
export class ProviderRegistry {
  constructor(
    @Inject(CLOUD_PROVIDER_LIST) private readonly providers: readonly CloudProvider[],
  ) {}

  get(id: string): CloudProvider {
    const provider = this.providers.find((item) => item.id === id);
    if (!provider) {
      throw new BadRequestException(UNKNOWN_PROVIDER);
    }
    return provider;
  }
}
