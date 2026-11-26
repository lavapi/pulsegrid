import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { ApnsClient } from './apns-client';
import { PushDevicesStore } from './push-devices.store';
import { APNS_CLIENT, PushNotifier } from './push-notifier';

/** Sending push notifications, for the API and the worker. */
@Module({
  providers: [
    { provide: APNS_CLIENT, inject: [APP_CONFIG], useFactory: (config: AppConfig) => config.apns && new ApnsClient(config.apns) },
    PushDevicesStore,
    PushNotifier,
  ],
  exports: [PushDevicesStore, PushNotifier],
})
export class PushCoreModule {}
