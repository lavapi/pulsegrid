const MISMATCH = "Passwords don't match";

export const passwordMismatch = (password: string, confirmation: string): string =>
  confirmation && password !== confirmation ? MISMATCH : '';
