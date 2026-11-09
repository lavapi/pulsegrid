import { z } from 'zod';

const REPOSITORY_PATTERN = /^[\w.-]+(\/[\w.-]+)+$/;

export const repositorySchema = z.string().regex(REPOSITORY_PATTERN).max(200);
export const pipelineScopeSchema = z.union([z.literal('none'), z.string().uuid()]).optional();
