import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@pulsegrid/shared';
import { z } from 'zod';

export const emailSchema = z.string().trim().email().max(254);
export const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH);
export const nameSchema = z.string().trim().min(1).max(100);
export const INVALID_PASSWORD = `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
