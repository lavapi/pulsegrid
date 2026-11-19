import type { ParameterSettings } from './aws-capacity';
import { type ParameterValue, parameterValue } from './parameter-formula';

/** How each Aurora engine sizes the data cache it sets aside at startup, and the unit its setting is in. */
const CACHE_SETTINGS: Record<string, { parameter: string; unitBytes: number }> = {
  'aurora-postgresql': { parameter: 'shared_buffers', unitBytes: 8 * 1024 },
  'aurora-mysql': { parameter: 'innodb_buffer_pool_size', unitBytes: 1 },
};

/** The parameter that sizes the engine's data cache, or null for engines that don't hold one back. */
export const cacheParameter = (engine: string | null): string | null =>
  (engine && CACHE_SETTINGS[engine]?.parameter) || null;

/**
 * The data cache Aurora reserves, which never counts as freeable memory, in bytes. Null for other engines, when
 * the setting is missing or unreadable, or when the result can't be right for the instance's memory.
 */
export const auroraCache = (
  engine: string | null,
  settings: ParameterSettings,
  memoryBytes: number,
): ParameterValue | null => {
  const cache = engine ? CACHE_SETTINGS[engine] : undefined;
  const read = cache ? parameterValue(settings.get(cache.parameter) ?? null, memoryBytes) : null;
  if (!cache || !read) {
    return null;
  }
  const bytes = read.value * cache.unitBytes;
  return bytes > 0 && bytes < memoryBytes ? { value: bytes, estimated: read.estimated } : null;
};
