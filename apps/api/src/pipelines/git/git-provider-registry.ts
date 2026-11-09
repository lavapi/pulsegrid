import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { GIT_PROVIDER_LIST, type GitProvider } from './git-provider';

const UNKNOWN_PROVIDER = "That Git provider isn't available.";

@Injectable()
export class GitProviderRegistry {
  constructor(@Inject(GIT_PROVIDER_LIST) private readonly providers: readonly GitProvider[]) {}

  get(id: string): GitProvider {
    const provider = this.providers.find((item) => item.id === id);
    if (!provider) {
      throw new BadRequestException(UNKNOWN_PROVIDER);
    }
    return provider;
  }
}
