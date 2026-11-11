import { describe, expect, it } from 'vitest';
import { hideLogValues, hideStatementValues, parsePostgresLine, parseSlowQuery } from './postgres-log';

const PREFIX = '2026-11-11 10:00:00 UTC:10.0.1.5(51234):game@gamedb:[4321]:';

describe('parsePostgresLine', () => {
  it('splits severity, session and text', () => {
    expect(parsePostgresLine(`${PREFIX}ERROR:  deadlock detected`)).toEqual({
      severity: 'ERROR',
      session: '10.0.1.5(51234):game@gamedb',
      text: 'deadlock detected',
    });
    expect(parsePostgresLine('checkpoint starting: time')).toEqual({ severity: 'LOG', session: '', text: 'checkpoint starting: time' });
  });
});

describe('parseSlowQuery', () => {
  it('reads statements logged by log_min_duration_statement', () => {
    expect(parseSlowQuery('duration: 1532.118 ms  statement: SELECT * FROM players WHERE id = 42')).toEqual({
      durationMs: 1532.118,
      statement: 'SELECT * FROM players WHERE id = 42',
    });
    expect(parseSlowQuery('duration: 250.5 ms  execute S_1: UPDATE wallets SET balance = $1 WHERE id = $2')).toEqual({
      durationMs: 250.5,
      statement: 'UPDATE wallets SET balance = $1 WHERE id = $2',
    });
    const multiLine = parseSlowQuery('duration: 12 ms  statement: SELECT 1\nFROM players');
    expect(multiLine?.statement).toBe('SELECT 1\nFROM players');
  });

  it('ignores other lines, including durations without a statement', () => {
    expect(parseSlowQuery('duration: 12.3 ms')).toBeNull();
    expect(parseSlowQuery('connection received: host=10.0.0.1')).toBeNull();
  });
});

describe('hiding values', () => {
  it('replaces literals in statements but keeps identifiers and parameters', () => {
    expect(hideStatementValues("SELECT * FROM players2 WHERE email = 'a@b.com' AND id = 42 AND x = $1")).toBe(
      "SELECT * FROM players2 WHERE email = '?' AND id = ? AND x = $1",
    );
    expect(hideStatementValues("SELECT 'it''s', E'a\\'b', -3.5")).toBe("SELECT '?', '?', ?");
  });

  it('hides key details and quoted values in messages, and every value in statements', () => {
    expect(
      hideLogValues({ severity: 'DETAIL', session: '', text: 'Key (email)=(a@example.com) already exists.' }),
    ).toBe('Key (email)=(?) already exists.');
    expect(hideLogValues({ severity: 'ERROR', session: '', text: 'invalid input syntax for type uuid: "abc"' })).toBe(
      'invalid input syntax for type uuid: "?"',
    );
    expect(hideLogValues({ severity: 'ERROR', session: '', text: 'relation "players" does not exist' })).toBe(
      'relation "players" does not exist',
    );
    expect(hideLogValues({ severity: 'ERROR', session: '', text: "value 'secret' is too long" })).toBe(
      "value '?' is too long",
    );
    expect(hideLogValues({ severity: 'STATEMENT', session: '', text: 'DELETE FROM sessions WHERE id = 7' })).toBe(
      'DELETE FROM sessions WHERE id = ?',
    );
  });
});
