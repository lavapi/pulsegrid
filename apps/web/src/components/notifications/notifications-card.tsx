'use client';

import { NOTIFICATION_TOPIC_LIST, NOTIFICATION_TOPICS, type NotificationSettings, type NotificationTopic } from '@pulsegrid/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardHeader } from '@/components/ui/card';
import { apiSendForJson } from '@/lib/browser-api';

/** Which push notifications the person gets in the iPhone app, the same switches as the app's own. */
export function NotificationsCard({ initial }: { initial: NotificationSettings }) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState<NotificationTopic | null>(null);

  const change = async (topic: NotificationTopic, on: boolean) => {
    const before = settings;
    setSettings({ ...settings, [topic]: on });
    setSaving(topic);
    const { data, error } = await apiSendForJson<NotificationSettings>('/account/notifications', 'PUT', { [topic]: on });
    setSaving(null);
    if (error || !data) {
      setSettings(before);
      toast.error(error ?? 'Your choice was not saved. Please try again.');
      return;
    }
    setSettings(data);
  };

  return (
    <Card>
      <CardHeader title="Notifications" description="What the PulseGrid iPhone app notifies you about, on every phone you're signed in on" />
      <ul className="divide-y">
        {NOTIFICATION_TOPIC_LIST.map((topic) => (
          <li key={topic} className="px-5 py-3">
            <label className="flex items-center justify-between gap-4 text-[13px]">
              <span>{NOTIFICATION_TOPICS[topic].label}</span>
              <input
                type="checkbox"
                role="switch"
                className="size-4 accent-primary"
                checked={settings[topic]}
                disabled={saving === topic}
                onChange={(event) => void change(topic, event.target.checked)}
              />
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}
