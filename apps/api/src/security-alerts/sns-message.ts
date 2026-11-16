import { z } from 'zod';

const common = {
  MessageId: z.string().min(1).max(128),
  TopicArn: z.string().min(1).max(256),
  Message: z.string(),
  Timestamp: z.string().min(1),
  SignatureVersion: z.enum(['1', '2']),
  Signature: z.string().min(1),
  SigningCertURL: z.string().min(1),
};

const confirmation = {
  ...common,
  Token: z.string().min(1),
  SubscribeURL: z.string().min(1),
};

export const snsMessageSchema = z.discriminatedUnion('Type', [
  z.object({ Type: z.literal('Notification'), ...common, Subject: z.string().optional() }),
  z.object({ Type: z.literal('SubscriptionConfirmation'), ...confirmation }),
  z.object({ Type: z.literal('UnsubscribeConfirmation'), ...confirmation }),
]);

/** The envelope SNS wraps every message in when raw delivery is off. */
export type SnsMessage = z.infer<typeof snsMessageSchema>;
