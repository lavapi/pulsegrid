import { describe, expect, it } from 'vitest';
import { parameterValue } from './parameter-formula';

const GIB = 1024 ** 3;

describe('parameterValue', () => {
  it('reads SUM with braces and a negative term, the Aurora PostgreSQL shared_buffers default', () => {
    const pages = parameterValue('SUM({DBInstanceClassMemory/12038},-50003)', 16 * GIB);
    expect(pages?.estimated).toBe(true);
    expect(pages?.value).toBeCloseTo(16 * GIB / 12038 - 50003, 3);
  });

  it('reads the Aurora MySQL innodb_buffer_pool_size default', () => {
    expect(parameterValue('{DBInstanceClassMemory*3/4}', 16 * GIB)).toEqual({ value: 12 * GIB, estimated: true });
  });

  it('takes a plain number as exact, without needing the memory', () => {
    expect(parameterValue('524288', null)).toEqual({ value: 524_288, estimated: false });
  });

  it('gives up on what it cannot read', () => {
    expect(parameterValue('SUM({DBInstanceClassMemory/12038},-50003)', null)).toBeNull();
    expect(parameterValue('IF(x,1,2)', 16 * GIB)).toBeNull();
    expect(parameterValue('SUM(-5)', 16 * GIB)).toBeNull();
    expect(parameterValue('', 16 * GIB)).toBeNull();
  });
});
