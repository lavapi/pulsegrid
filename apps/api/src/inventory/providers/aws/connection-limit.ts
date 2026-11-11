/**
 * Works out RDS max_connections from its parameter group value. AWS defaults are formulas such as
 * LEAST({DBInstanceClassMemory/9531392},5000); this reads only numbers, DBInstanceClassMemory,
 * + - * /, braces, LEAST, GREATEST, SUM and log (base 2), and treats anything else as unknown.
 */

export interface ConnectionLimit {
  value: number;
  /** True when it came from a formula, because AWS keeps some memory back from DBInstanceClassMemory. */
  estimated: boolean;
}

type Token = { kind: 'number'; value: number } | { kind: 'name'; value: string } | { kind: 'symbol'; value: string };

const TOKEN = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z]+)|([-+*/(){},]))/y;
const FUNCTIONS: Record<string, (values: number[]) => number> = {
  LEAST: (values) => Math.min(...values),
  GREATEST: (values) => Math.max(...values),
  SUM: (values) => values.reduce((sum, value) => sum + value, 0),
  LOG: ([value = 0]) => Math.log2(value),
};
const MEMORY = 'DBINSTANCECLASSMEMORY';
const CLOSING: Record<string, string> = { '(': ')', '{': '}' };

const tokenize = (source: string): Token[] | null => {
  const tokens: Token[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.trimEnd().length) {
    const match = TOKEN.exec(source);
    if (!match) {
      return null;
    }
    const [, number, name, symbol] = match;
    tokens.push(
      number !== undefined
        ? { kind: 'number', value: Number(number) }
        : name !== undefined
          ? { kind: 'name', value: name.toUpperCase() }
          : { kind: 'symbol', value: symbol ?? '' },
    );
  }
  return tokens;
};

class Parser {
  private position = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly memoryBytes: number,
  ) {}

  parse(): number {
    const value = this.sum();
    if (this.position !== this.tokens.length) {
      throw new Error('Unexpected input');
    }
    return value;
  }

  private sum(): number {
    let value = this.product();
    while (this.isSymbol('+') || this.isSymbol('-')) {
      const operator = this.next().value;
      const right = this.product();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  private product(): number {
    let value = this.unary();
    while (this.isSymbol('*') || this.isSymbol('/')) {
      const operator = this.next().value;
      const right = this.unary();
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  }

  private unary(): number {
    if (this.isSymbol('-')) {
      this.next();
      return -this.unary();
    }
    return this.atom();
  }

  private atom(): number {
    const token = this.next();
    if (token.kind === 'number') {
      return token.value;
    }
    if (token.kind === 'symbol' && CLOSING[token.value]) {
      const value = this.sum();
      this.expect(CLOSING[token.value] ?? '');
      return value;
    }
    if (token.kind === 'name' && token.value === MEMORY) {
      return this.memoryBytes;
    }
    const call = token.kind === 'name' ? FUNCTIONS[token.value] : undefined;
    if (!call) {
      throw new Error('Unknown name');
    }
    this.expect('(');
    const values = [this.sum()];
    while (this.isSymbol(',')) {
      this.next();
      values.push(this.sum());
    }
    this.expect(')');
    return call(values);
  }

  private isSymbol(value: string): boolean {
    const token = this.tokens[this.position];
    return token?.kind === 'symbol' && token.value === value;
  }

  private expect(value: string): void {
    if (!this.isSymbol(value)) {
      throw new Error(`Expected ${value}`);
    }
    this.position += 1;
  }

  private next(): Token {
    const token = this.tokens[this.position];
    if (!token) {
      throw new Error('Unexpected end');
    }
    this.position += 1;
    return token;
  }
}

/** The connection limit, or null when the setting is missing or a formula this can't read. */
export const connectionLimit = (setting: string | null, memoryBytes: number | null): ConnectionLimit | null => {
  const source = setting?.trim();
  if (!source) {
    return null;
  }
  if (/^\d+$/.test(source)) {
    return Number(source) > 0 ? { value: Number(source), estimated: false } : null;
  }
  const tokens = tokenize(source);
  if (!tokens || memoryBytes === null) {
    return null;
  }
  try {
    const value = Math.floor(new Parser(tokens, memoryBytes).parse());
    return Number.isFinite(value) && value > 0 ? { value, estimated: true } : null;
  } catch {
    return null;
  }
};
