/** Stands for every resource of a type, when a test could pick any of them. */
export const ANY = '*';
const SEPARATOR = '|';

/** A resource a test acts on, as `type|id`, so a test on any database clashes with a test on one database. */
export const resourceKey = (type: string, id: string): string => `${type}${SEPARATOR}${id}`;

export const parseKey = (key: string): { type: string; id: string } => {
  const at = key.lastIndexOf(SEPARATOR);
  return { type: key.slice(0, at), id: key.slice(at + 1) };
};

export const keysClash = (first: string, second: string): boolean => {
  const a = parseKey(first);
  const b = parseKey(second);
  return a.type === b.type && (a.id === b.id || a.id === ANY || b.id === ANY);
};
