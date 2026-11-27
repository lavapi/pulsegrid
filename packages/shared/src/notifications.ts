/** What a person can get push notifications about, each on or off for them. */
export const NOTIFICATION_TOPICS = {
  database_access: { label: 'Database access requests and their answers', default: true },
  production_releases: { label: 'Production releases waiting for a decision', default: true },
  unhealthy_production: { label: 'Services turning unhealthy in production', default: true },
  unhealthy_staging: { label: 'Services turning unhealthy in staging', default: false },
  failed_pipelines: { label: 'Pipelines I started that failed', default: true },
} as const;

export type NotificationTopic = keyof typeof NOTIFICATION_TOPICS;

export type NotificationSettings = Record<NotificationTopic, boolean>;

export const NOTIFICATION_TOPIC_LIST = Object.keys(NOTIFICATION_TOPICS) as NotificationTopic[];

export const DEFAULT_NOTIFICATION_SETTINGS = Object.fromEntries(
  NOTIFICATION_TOPIC_LIST.map((topic) => [topic, NOTIFICATION_TOPICS[topic].default]),
) as NotificationSettings;

/** Saved choices over the defaults, ignoring anything unknown. */
export const notificationSettings = (saved: Partial<Record<string, unknown>>): NotificationSettings =>
  Object.fromEntries(
    NOTIFICATION_TOPIC_LIST.map((topic) => {
      const value = saved[topic];
      return [topic, typeof value === 'boolean' ? value : DEFAULT_NOTIFICATION_SETTINGS[topic]];
    }),
  ) as NotificationSettings;
