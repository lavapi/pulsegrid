/** Which Apple push service a phone's token belongs to: Xcode builds use the sandbox, App Store builds production. */
export type PushEnvironment = 'sandbox' | 'production';

export interface PushMessage {
  title: string;
  body: string;
  /** The app screen to open when it is tapped, such as "/settings/database-access". */
  path: string;
  /** Replaces an earlier notification about the same thing instead of adding another. */
  collapseId: string;
}

/** What Apple said: sent, the phone no longer takes notifications (forget it), or anything else. */
export type PushResult = 'sent' | 'gone' | 'failed';

/** Something that delivers a notification to one phone: Apple directly, or the relay in front of it. */
export interface PushSender {
  send(deviceToken: string, environment: PushEnvironment, message: PushMessage): Promise<PushResult>;
}
