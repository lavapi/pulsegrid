/** Which personal Slack messages a person gets; all start on. */
export interface NotificationSwitches {
  prReady: boolean;
  prFailed: boolean;
  deployReady: boolean;
  deployFailed: boolean;
}

export const NOTIFICATION_SWITCH_LABELS: Record<keyof NotificationSwitches, string> = {
  prReady: 'My pull request is ready to merge',
  prFailed: "My pull request's checks failed",
  deployReady: 'A deploy I started is ready',
  deployFailed: 'A deploy I started failed',
};

/** Where a person stands with Slack: why they can't get messages yet, or their Slack name. */
export type SlackReach =
  | { status: 'not-connected' }
  | { status: 'not-found' }
  | { status: 'found'; name: string }
  | { status: 'unknown' };

export interface MyNotifications extends NotificationSwitches {
  githubLogin: string | null;
  slack: SlackReach;
}

export type MyNotificationsInput = NotificationSwitches & { githubLogin: string | null };

export interface SlackApp {
  connected: boolean;
  /** The Slack workspace the app is installed in. */
  workspace: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** The Slack app to create: paste this manifest under "Create an app" → "From a manifest". */
export const SLACK_APP_MANIFEST = JSON.stringify(
  {
    display_information: { name: 'PulseGrid', description: 'Personal messages about your pull requests and deploys' },
    features: { bot_user: { display_name: 'PulseGrid', always_online: true } },
    oauth_config: { scopes: { bot: ['chat:write', 'users:read', 'users:read.email'] } },
    settings: { org_deploy_enabled: false, socket_mode_enabled: false, token_rotation_enabled: false },
  },
  null,
  2,
);
