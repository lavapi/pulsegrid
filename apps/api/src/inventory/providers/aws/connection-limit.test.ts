import { describe, expect, it } from 'vitest';
import { connectionLimit } from './connection-limit';

const GIB = 1024 ** 3;

describe('connectionLimit', () => {
  it('takes a number set in the parameter group as exact', () => {
    expect(connectionLimit('500', 4 * GIB)).toEqual({ value: 500, estimated: false });
    expect(connectionLimit(' 120 ', null)).toEqual({ value: 120, estimated: false });
  });

  it('works out the PostgreSQL default from memory', () => {
    expect(connectionLimit('LEAST({DBInstanceClassMemory/9531392},5000)', 4 * GIB)).toEqual({ value: 450, estimated: true });
    expect(connectionLimit('LEAST({DBInstanceClassMemory/9531392},5000)', 256 * GIB)).toEqual({ value: 5000, estimated: true });
  });

  it('works out the MySQL and Aurora MySQL defaults', () => {
    expect(connectionLimit('{DBInstanceClassMemory/12582880}', 8 * GIB)?.value).toBe(682);
    const aurora = 'GREATEST({log(DBInstanceClassMemory/805306368)*45},{log(DBInstanceClassMemory/8187281408)*1000})';
    expect(connectionLimit(aurora, 16 * GIB)?.value).toBe(1069);
  });

  it('gives up on anything it cannot read, rather than guessing or running it', () => {
    expect(connectionLimit('IF(x, 1, 2)', 4 * GIB)).toBeNull();
    expect(connectionLimit('{DBInstanceClassMemory/9531392', 4 * GIB)).toBeNull();
    expect(connectionLimit('process.exit()', 4 * GIB)).toBeNull();
    expect(connectionLimit('{DBInstanceClassMemory/9531392}', null)).toBeNull();
    expect(connectionLimit(null, 4 * GIB)).toBeNull();
    expect(connectionLimit('0', 4 * GIB)).toBeNull();
  });
});
