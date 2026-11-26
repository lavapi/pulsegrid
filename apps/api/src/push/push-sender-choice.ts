import { ApnsClient, type PushSender } from '@pulsegrid/push';
import type { AppConfig } from '../config/app-config';
import { RelayClient, type RelayInstallations } from './relay-client';

/** Apple directly with the server's own key, else the push relay, else nothing is sent. */
export const pushSenderFor = (
  config: Pick<AppConfig, 'apns' | 'pushRelayUrl'>,
  installations: RelayInstallations,
): PushSender | null => {
  if (config.apns) return new ApnsClient(config.apns);
  return config.pushRelayUrl ? new RelayClient(config.pushRelayUrl, installations) : null;
};
