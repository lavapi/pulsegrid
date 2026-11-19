import { describe, expect, it } from 'vitest';
import { auroraCache, cacheParameter } from './aurora-cache';

const GIB = 1024 ** 3;
const settings = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe('auroraCache', () => {
  it('works out the Aurora PostgreSQL default, in 8 KiB pages, as an estimate', () => {
    const cache = auroraCache('aurora-postgresql', settings({ shared_buffers: 'SUM({DBInstanceClassMemory/12038},-50003)' }), 16 * GIB);
    expect(cache?.estimated).toBe(true);
    expect(cache?.value).toBeCloseTo((16 * GIB / 12038 - 50003) * 8192, -3);
    expect((cache?.value ?? 0) / GIB).toBeCloseTo(10.5, 1);
  });

  it('takes a shared_buffers set by hand as exact', () => {
    expect(auroraCache('aurora-postgresql', settings({ shared_buffers: '524288' }), 16 * GIB)).toEqual({
      value: 4 * GIB,
      estimated: false,
    });
  });

  it('works out the Aurora MySQL buffer pool, in bytes', () => {
    expect(
      auroraCache('aurora-mysql', settings({ innodb_buffer_pool_size: '{DBInstanceClassMemory*3/4}' }), 16 * GIB),
    ).toEqual({ value: 12 * GIB, estimated: true });
  });

  it('knows nothing for other engines, missing settings, or a cache as big as the memory', () => {
    expect(auroraCache('postgres', settings({ shared_buffers: '524288' }), 16 * GIB)).toBeNull();
    expect(auroraCache('aurora-postgresql', settings({}), 16 * GIB)).toBeNull();
    expect(auroraCache('aurora-postgresql', settings({ shared_buffers: 'IF(x)' }), 16 * GIB)).toBeNull();
    expect(auroraCache('aurora-postgresql', settings({ shared_buffers: '2097152' }), 16 * GIB)).toBeNull();
  });

  it('names the setting for each Aurora engine only', () => {
    expect(cacheParameter('aurora-postgresql')).toBe('shared_buffers');
    expect(cacheParameter('aurora-mysql')).toBe('innodb_buffer_pool_size');
    expect(cacheParameter('postgres')).toBeNull();
    expect(cacheParameter(null)).toBeNull();
  });
});
