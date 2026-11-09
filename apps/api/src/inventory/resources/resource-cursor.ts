import { z } from 'zod';

export interface ResourceCursor {
  name: string;
  id: string;
}

const cursorSchema = z.tuple([z.string(), z.string().uuid()]);

export const encodeResourceCursor = ({ name, id }: ResourceCursor): string =>
  Buffer.from(JSON.stringify([name, id])).toString('base64url');

export const decodeResourceCursor = (encoded: string): ResourceCursor | null => {
  try {
    const parsed = cursorSchema.safeParse(
      JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')),
    );
    return parsed.success ? { name: parsed.data[0], id: parsed.data[1] } : null;
  } catch {
    return null;
  }
};
