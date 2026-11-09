const UNIQUE_VIOLATION = '23505';

export const isUniqueViolation = (error: unknown): boolean =>
  (error as { code?: string }).code === UNIQUE_VIOLATION;
