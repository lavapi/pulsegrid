import { EXPERIMENT_GROUP_NAME_LIMIT, EXPERIMENT_RUN_LIMIT, templateKey } from '@pulsegrid/shared';
import { z } from 'zod';

export const READ_LIMIT = { default: { limit: 60, ttl: 60_000 } };
export const CHANGE_LIMIT = { default: { limit: 10, ttl: 60_000 } };
export const INVALID_REQUEST = 'That experiment request is not valid.';
export const INVALID_GROUP = `Give the group a name and pick 1 to ${EXPERIMENT_RUN_LIMIT} different templates.`;

export const region = z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d{1,2}$/);
export const awsId = z.string().regex(/^[A-Za-z0-9]{1,64}$/);

const templateRef = z.object({ region, templateId: awsId });

export const groupSchema = z.object({
  name: z.string().trim().min(1).max(EXPERIMENT_GROUP_NAME_LIMIT),
  templates: z
    .array(templateRef)
    .min(1)
    .max(EXPERIMENT_RUN_LIMIT)
    .refine((templates) => new Set(templates.map(templateKey)).size === templates.length),
});

export const runSchema = z.object({ groupId: z.uuid().optional() });
