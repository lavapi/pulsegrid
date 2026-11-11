const SEVERITY =
  /:(DEBUG\d?|INFO|NOTICE|WARNING|ERROR|LOG|FATAL|PANIC|DETAIL|HINT|STATEMENT|CONTEXT|QUERY|LOCATION):\s+/;
const SESSION = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)? \w+:(.*?):\[\d+\]$/;
const SLOW = /duration: ([\d.]+) ms\s+(?:statement|execute [^:]*|parse [^:]*|bind [^:]*):\s?([\s\S]*)$/;
const QUOTED = /(?:\bE)?'(?:[^'\\]|''|\\.)*'/g;
const NUMBER = /(?<![\w$.])-?\d+(?:\.\d+)?(?![\w.])/g;
const KEY_VALUES = /=\((.*?)\)/g;
/** The input value Postgres repeats at the end, as in invalid input syntax for type uuid: "…". */
const TRAILING_INPUT = /: "(?:[^"\\]|\\.)*"$/;
const STATEMENT_LINE = /^(STATEMENT|QUERY)$/;
const HIDDEN = '?';

export interface PostgresLine {
  severity: string;
  /** Who wrote the line, such as 10.0.0.5(51234):app@game, or empty when the line doesn't say. */
  session: string;
  text: string;
}

/** Splits an RDS PostgreSQL log line into its severity, its session and what it says. */
export const parsePostgresLine = (message: string): PostgresLine => {
  const match = SEVERITY.exec(message);
  if (!match) {
    return { severity: 'LOG', session: '', text: message.trim() };
  }
  const prefix = message.slice(0, match.index);
  return {
    severity: match[1] ?? 'LOG',
    session: SESSION.exec(prefix)?.[1] ?? '',
    text: message.slice(match.index + match[0].length).trim(),
  };
};

/** A statement with its values replaced by ?, so emails, ids and tokens don't show. */
export const hideStatementValues = (statement: string): string =>
  statement.replace(QUOTED, `'${HIDDEN}'`).replace(NUMBER, HIDDEN);

/** A log message with quoted values and key details like Key (email)=(…) hidden; statements lose every value. */
export const hideLogValues = ({ severity, text }: PostgresLine): string =>
  STATEMENT_LINE.test(severity)
    ? hideStatementValues(text)
    : text.replace(QUOTED, `'${HIDDEN}'`).replace(KEY_VALUES, `=(${HIDDEN})`).replace(TRAILING_INPUT, `: "${HIDDEN}"`);

export interface SlowStatement {
  durationMs: number;
  statement: string;
}

/** A "duration: N ms statement: …" line, written when log_min_duration_statement is on, or null for others. */
export const parseSlowQuery = (text: string): SlowStatement | null => {
  const match = SLOW.exec(text);
  if (!match || !match[2]?.trim()) {
    return null;
  }
  return { durationMs: Number(match[1]), statement: match[2].trim() };
};
