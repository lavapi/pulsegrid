import { hash, verify } from '@node-rs/argon2';

const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
const decoyHash = hash('no account has this password', OPTIONS);

export const hashPassword = (password: string): Promise<string> => hash(password, OPTIONS);

export const verifyPassword = async (
  storedHash: string | null | undefined,
  password: string,
): Promise<boolean> => {
  const matches = await verify(storedHash ?? (await decoyHash), password);
  return Boolean(storedHash) && matches;
};
