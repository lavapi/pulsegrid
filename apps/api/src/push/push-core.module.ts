import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { TokenCipher } from '../inventory/connection/token-cipher';
import { PushDevicesStore } from './push-devices.store';
import { PUSH_SENDER, PushNotifier } from './push-notifier';
import { pushSenderFor } from './push-sender-choice';
import { RelayInstallationsStore } from './relay-installations.store';

/** Sending push notifications, for the API and the worker. */
@Module({
  providers: [
    { provide: TokenCipher, inject: [APP_CONFIG], useFactory: (config: AppConfig) => new TokenCipher(config.tokenEncryptionKey) },
    RelayInstallationsStore,
    {
      provide: PUSH_SENDER,
      inject: [APP_CONFIG, RelayInstallationsStore],
      useFactory: (config: AppConfig, installations: RelayInstallationsStore) => pushSenderFor(config, installations),
    },
    PushDevicesStore,
    PushNotifier,
  ],
  exports: [PushDevicesStore, PushNotifier],
})
export class PushCoreModule {}
